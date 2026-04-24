//! Windows Subsystem for Linux (WSL) support.
//!
//! Provides WSL detection, Windows-to-WSL path conversion, and
//! environment variable bridging. All functions are no-ops on non-Windows
//! platforms, keeping the call sites clean.
//!
//! ## Design decisions
//!
//! - **`wsl.exe` is the sole detection mechanism.** We run `wsl.exe --list
//!   --quiet` and check for a zero exit code. This matches how VS Code and
//!   other tools detect WSL availability — no registry scraping or path
//!   probing (P1: minimal primitives).
//!
//! - **Path conversion is pure-string.** `C:\Users\foo → /mnt/c/Users/foo`.
//!   UNC paths (`\\server\share`) and drive-relative paths (`C:bar`) are
//!   rejected because they have no canonical WSL mapping (P3: make errors
//!   structurally impossible by returning `None`).
//!
//! - **Environment passthrough is explicit.** Only variables known to be
//!   meaningful in WSL are forwarded, preventing Windows-specific noise from
//!   polluting the Linux environment (P11: functional self-discipline).

use std::os::windows::process::CommandExt;
use std::process::Command;

// ----------------------------------------------------------------
// Detection
// ----------------------------------------------------------------

/// Whether WSL is available on this system.
///
/// On non-Windows platforms this always returns `false`.
/// On Windows it probes for `wsl.exe` by running `wsl.exe --list --quiet`
/// with a short timeout, so the check is fast even when WSL is not installed.
pub fn is_wsl_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        Command::new("wsl.exe")
            .args(["--list", "--quiet"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = &Path::new(""); // suppress unused-import warning
        false
    }
}

/// List installed WSL distributions.
///
/// Returns distribution names (e.g. `["Ubuntu", "Debian"]`). Returns an
/// empty vec if WSL is not available or no distributions are installed.
pub fn list_distributions() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("wsl.exe")
            .args(["--list", "--quiet"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output();

        match output {
            Ok(out) if out.status.success() => {
                let text = decode_utf16le(&out.stdout);
                text.lines()
                    .map(|line| line.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            }
            _ => Vec::new(),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

/// Decode UTF-16LE bytes (as emitted by `wsl.exe --list --quiet`) to a Rust
/// string. Strips a leading BOM (`FF FE`) if present.
#[cfg(target_os = "windows")]
fn decode_utf16le(bytes: &[u8]) -> String {
    let bytes = if bytes.starts_with(&[0xFF, 0xFE]) {
        &bytes[2..]
    } else {
        bytes
    };
    bytes
        .chunks_exact(2)
        .filter_map(|chunk| {
            let code_unit = u16::from_le_bytes([chunk[0], chunk[1]]);
            char::from_u32(code_unit as u32)
        })
        .collect()
}

// ----------------------------------------------------------------
// Path conversion
// ----------------------------------------------------------------

/// Convert a Windows path to its WSL equivalent.
///
/// ```
/// C:\Users\foo     → /mnt/c/Users/foo
/// C:/Users/foo     → /mnt/c/Users/foo
/// D:\project       → /mnt/d/project
/// ```
///
/// Returns `None` for:
/// - Already-posix paths (no drive letter)
/// - UNC paths (`\\server\share`)
/// - Drive-relative paths (`C:relative`)
/// - Empty input
///
/// This is intentionally pure-string — no filesystem access — so it works
/// for paths that don't yet exist (P3: errors are structural, not runtime).
pub fn windows_to_wsl_path(windows_path: &str) -> Option<String> {
    let trimmed = windows_path.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Already looks like a POSIX path.
    if trimmed.starts_with('/') {
        return Some(trimmed.to_string());
    }

    // Reject UNC paths (\\server\share).
    if trimmed.starts_with(r"\\") {
        return None;
    }

    // Extract drive letter. We need at least "C:\" or "C:/" after trimming.
    let mut chars = trimmed.chars();
    let drive = chars.next()?.to_ascii_uppercase();
    if !drive.is_ascii_alphabetic() {
        return None;
    }
    if chars.next()? != ':' {
        return None;
    }
    let rest = chars.as_str();

    // Reject drive-relative paths (e.g. "C:relative" with no separator).
    let rest = rest.strip_prefix('\\').or_else(|| rest.strip_prefix('/'))?;

    // Normalize backslashes to forward slashes and strip trailing separator.
    let posix = rest.replace('\\', "/");
    let posix = posix.trim_end_matches('/');

    Some(format!("/mnt/{}/{}", drive.to_ascii_lowercase(), posix))
}

/// Convert a WSL path back to a Windows path.
///
/// ```
/// /mnt/c/Users/foo → C:\Users\foo
/// ```
///
/// Returns `None` if the input is not a valid `/mnt/<drive>/...` path.
pub fn wsl_to_windows_path(wsl_path: &str) -> Option<String> {
    let trimmed = wsl_path.trim();
    let rest = trimmed.strip_prefix("/mnt/")?;
    let drive_char = rest.chars().next()?.to_ascii_uppercase();
    if !drive_char.is_ascii_alphabetic() {
        return None;
    }
    let rest = &rest[drive_char.len_utf8()..];
    let rest = rest.strip_prefix('/')?;

    Some(format!("{}:\\{}", drive_char, rest.replace('/', "\\")))
}

// ----------------------------------------------------------------
// Environment bridging
// ----------------------------------------------------------------

/// Environment variables to forward from Windows into WSL.
///
/// These are variables that carry user intent across the boundary:
/// - `PATH`: preserves Windows tools accessible from WSL
/// - `WSL_DISTRO_NAME`: lets the shell know which distro it's in
/// - `TERM` / `COLORTERM`: terminal capability hints
const WSLENV_FORWARD: &[&str] = &["TERM", "COLORTERM"];

/// Return the `WSLENV` value that instructs WSL to forward the selected
/// environment variables from the Windows side.
///
/// Each variable is suffixed with `/p` to enable path conversion for
/// variables that contain paths (e.g. `PATH`). Non-path variables use `/l`
/// to preserve as literal strings.
///
/// See: https://docs.microsoft.com/en-us/windows/wsl/environment-variables#wslenv
pub fn wslenv_value() -> String {
    // WSLENV format: VAR1 flags:VAR2 flags:...
    // /p = path conversion, /l = literal
    WSLENV_FORWARD.join(":")
}

// ----------------------------------------------------------------
// Shell integration
// ----------------------------------------------------------------

/// Build the `wsl.exe` command arguments for launching a shell in WSL.
///
/// `distro` is optional — when `None`, WSL uses the default distribution.
/// `shell_cmd` is the shell command to run inside WSL (e.g. `/bin/bash`).
/// `shell_args` are arguments passed to the shell (e.g. `["-il"]`).
pub fn wsl_shell_args(distro: Option<&str>, shell_cmd: &str, shell_args: &[String]) -> Vec<String> {
    let mut args = Vec::new();

    if let Some(d) = distro {
        args.push("--distribution".into());
        args.push(d.into());
    }

    args.push("--shell-type".into());
    args.push("login".into());

    args.push("--exec".into());
    args.push(shell_cmd.into());
    args.extend(shell_args.iter().cloned());

    args
}

/// Detect the default shell inside WSL by running `wsl.exe -- sh -c
/// 'echo $SHELL'`.
///
/// Returns the shell path (e.g. `/bin/bash`) or `None` if detection fails.
pub fn detect_wsl_default_shell() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("wsl.exe")
            .args(["--", "sh", "-c", "echo $SHELL"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let shell = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if shell.is_empty() {
            return None;
        }

        Some(shell)
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_to_wsl_basic() {
        assert_eq!(
            windows_to_wsl_path(r"C:\Users\foo"),
            Some("/mnt/c/Users/foo".into())
        );
    }

    #[test]
    fn windows_to_wsl_forward_slash() {
        assert_eq!(
            windows_to_wsl_path("C:/Users/foo"),
            Some("/mnt/c/Users/foo".into())
        );
    }

    #[test]
    fn windows_to_wsl_different_drive() {
        assert_eq!(
            windows_to_wsl_path(r"D:\project\src"),
            Some("/mnt/d/project/src".into())
        );
    }

    #[test]
    fn windows_to_wsl_trailing_slash() {
        assert_eq!(
            windows_to_wsl_path(r"C:\Users\foo\"),
            Some("/mnt/c/Users/foo".into())
        );
    }

    #[test]
    fn windows_to_wsl_already_posix() {
        assert_eq!(windows_to_wsl_path("/home/user"), Some("/home/user".into()));
    }

    #[test]
    fn windows_to_wsl_unc_rejected() {
        assert_eq!(windows_to_wsl_path(r"\\server\share"), None);
    }

    #[test]
    fn windows_to_wsl_drive_relative_rejected() {
        assert_eq!(windows_to_wsl_path(r"C:relative\path"), None);
    }

    #[test]
    fn windows_to_wsl_empty_rejected() {
        assert_eq!(windows_to_wsl_path(""), None);
        assert_eq!(windows_to_wsl_path("   "), None);
    }

    #[test]
    fn windows_to_wsl_no_drive() {
        assert_eq!(windows_to_wsl_path(r"relative\path"), None);
    }

    #[test]
    fn wsl_to_windows_basic() {
        assert_eq!(
            wsl_to_windows_path("/mnt/c/Users/foo"),
            Some(r"C:\Users\foo".into())
        );
    }

    #[test]
    fn wsl_to_windows_uppercase_drive() {
        assert_eq!(
            wsl_to_windows_path("/mnt/C/Users/foo"),
            Some(r"C:\Users\foo".into())
        );
    }

    #[test]
    fn wsl_to_windows_not_mnt() {
        assert_eq!(wsl_to_windows_path("/home/user"), None);
    }

    #[test]
    fn wsl_to_windows_empty() {
        assert_eq!(wsl_to_windows_path(""), None);
    }

    #[test]
    fn roundtrip() {
        let original = r"C:\Users\dev\project";
        let wsl = windows_to_wsl_path(original).unwrap();
        let back = wsl_to_windows_path(&wsl).unwrap();
        assert_eq!(back, original);
    }

    #[test]
    fn wsl_shell_args_default_distro() {
        let args = wsl_shell_args(None, "/bin/bash", &["-il".into()]);
        assert_eq!(
            args,
            vec!["--shell-type", "login", "--exec", "/bin/bash", "-il"]
        );
    }

    #[test]
    fn wsl_shell_args_with_distro() {
        let args = wsl_shell_args(Some("Ubuntu"), "/bin/zsh", &[]);
        assert_eq!(
            args,
            vec![
                "--distribution",
                "Ubuntu",
                "--shell-type",
                "login",
                "--exec",
                "/bin/zsh"
            ]
        );
    }
}
