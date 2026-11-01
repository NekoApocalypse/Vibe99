//! Windows Subsystem for Linux (WSL) support.
//!
//! Provides WSL detection, Windows-to-WSL path conversion, and
//! environment variable bridging. All functions are no-ops on non-Windows
//! platforms, keeping the call sites clean.
//!
//! Discovery is optional, host-only and bounded. Never call it while selecting
//! a native shell or on the window event thread.

#[cfg(target_os = "windows")]
use std::{os::windows::process::CommandExt, process::Command};

/// Locate the Windows launcher without depending on PATH or guest interop.
pub fn launcher_path() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let root = std::path::PathBuf::from(std::env::var_os("SystemRoot")?);
        // Sysnative bypasses filesystem redirection for a 32-bit process.
        for directory in ["Sysnative", "System32"] {
            let path = root.join(directory).join("wsl.exe");
            if path.is_file() { return Some(path); }
        }
    }
    None
}

/// Execute only an owned discovery probe, with bounded time and output.
/// A temporary file avoids pipe deadlocks, including inherited pipe handles.
#[cfg(target_os = "windows")]
fn run_probe(command: &mut Command, timeout: std::time::Duration) -> Result<Vec<u8>, String> {
    use std::io::{Read, Seek, SeekFrom};
    use std::process::Stdio;
    use std::time::Instant;
    const MAX_OUTPUT: u64 = 64 * 1024;
    let mut output = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(output.try_clone().map_err(|e| e.to_string())?)
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000)
        .spawn().map_err(|e| format!("Could not start WSL discovery: {e}"))?;
    let started = Instant::now();
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break Ok(()),
            Ok(Some(status)) => break Err(format!("WSL discovery exited with {status}")),
            Err(e) => break Err(e.to_string()),
            Ok(None) => {}
        }
        if started.elapsed() >= timeout {
            break Err("WSL discovery timed out. Local shells are still available.".into());
        }
        if output.metadata().map(|m| m.len()).unwrap_or(MAX_OUTPUT + 1) > MAX_OUTPUT {
            break Err("WSL discovery returned too much output".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    };
    if result.is_err() { let _ = child.kill(); }
    let _ = child.wait(); // Reap only our probe; never terminate a distro or service.
    result?;
    output.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    output.take(MAX_OUTPUT + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_OUTPUT { return Err("WSL discovery returned too much output".into()); }
    Ok(bytes)
}

/// Single-flight discovery with a short cache for both success and failure.
/// Call from a blocking worker only. No Linux process is started.
pub fn discover_distributions() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::sync::Mutex;
        use std::time::{Duration, Instant};
        type Entry = (Instant, Result<Vec<String>, String>);
        static CACHE: Mutex<Option<Entry>> = Mutex::new(None);
        let mut cache = CACHE.lock().map_err(|e| e.to_string())?;
        if let Some((when, result)) = &*cache {
            if when.elapsed() < Duration::from_secs(5) { return result.clone(); }
        }
        let result = (|| {
            let path = launcher_path().ok_or("WSL launcher was not found")?;
            let bytes = run_probe(Command::new(path).args(["--list", "--quiet"]), Duration::from_secs(3))?;
            Ok(decode_utf16le(&bytes).lines().map(str::trim)
                .filter(|s| !s.is_empty()).map(str::to_owned).collect())
        })();
        *cache = Some((Instant::now(), result.clone()));
        result
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(Vec::new()) }
}

#[cfg(target_os = "windows")]
fn decode_utf16le(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xFF, 0xFE]).unwrap_or(bytes);
    let words: Vec<u16> = bytes.chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    String::from_utf16_lossy(&words)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn stalled_probe_is_bounded() {
        let start = std::time::Instant::now();
        let result = run_probe(
            Command::new("powershell.exe").args(["-NoProfile", "-Command", "Start-Sleep -Seconds 60"]),
            std::time::Duration::from_millis(150),
        );
        assert!(result.unwrap_err().contains("timed out"));
        assert!(start.elapsed() < std::time::Duration::from_secs(3));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn probe_collects_output_and_reports_failure() {
        let timeout = std::time::Duration::from_secs(3);
        let bytes = run_probe(Command::new("cmd.exe").args(["/d", "/c", "echo probe-ok"]), timeout).unwrap();
        assert!(String::from_utf8_lossy(&bytes).contains("probe-ok"));
        assert!(run_probe(Command::new("cmd.exe").args(["/d", "/c", "exit /b 7"]), timeout).is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn distribution_names_preserve_unicode() {
        let words: Vec<u8> = "\u{feff}Ubuntu-🐈\r\n".encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_utf16le(&words), "Ubuntu-🐈\r\n");
    }

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
