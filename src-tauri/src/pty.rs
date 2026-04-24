use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

use crate::wsl;

/// Minimum column count for a PTY session.
const MIN_COLS: u16 = 20;

/// Minimum row count for a PTY session.
const MIN_ROWS: u16 = 8;

/// Default column count when none is specified.
const DEFAULT_COLS: u16 = 80;

/// Default row count when none is specified.
const DEFAULT_ROWS: u16 = 24;

/// A shell candidate for the fallback chain.
pub struct ShellCandidate {
    pub shell: PathBuf,
    pub args: Vec<String>,
    /// Optional display override used to derive unique profile id and name.
    pub display_name: Option<String>,
}

/// Derive a slug-style id from a display name.
///
/// `"WSL (Ubuntu)"` → `"wsl-ubuntu"`, `"PowerShell"` → `"powershell"`.
/// Non-alphanumeric runs become a single `-`; leading/trailing dashes are stripped.
pub fn display_name_to_id(name: &str) -> String {
    use regex::Regex;
    let re = Regex::new(r"[^a-z0-9]+").unwrap();
    re.replace_all(&name.to_lowercase(), "-")
        .trim_matches('-')
        .to_string()
}

/// Payload emitted on `vibe99:terminal-data`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalDataPayload {
    pane_id: String,
    data: String,
}

/// Payload emitted on `vibe99:terminal-exit`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    pane_id: String,
    exit_code: u32,
}

/// Holds the live resources for a single PTY session.
struct PtySession {
    /// The master end of the PTY pair. Kept alive so the child process
    /// has a valid controlling terminal. Dropping this causes the child
    /// to receive SIGHUP.
    master: Box<dyn MasterPty + Send>,
    /// Writer to the PTY master (stdin of the child process).
    writer: Box<dyn Write + Send>,
    /// Killer handle to terminate the child process.
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// Join handle for the background reader thread.
    _reader_thread: std::thread::JoinHandle<()>,
    /// Join handle for the exit-watcher thread.
    _exit_thread: std::thread::JoinHandle<()>,
}

/// Manages a collection of PTY sessions keyed by pane ID.
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    // ----------------------------------------------------------------
    // Public API
    // ----------------------------------------------------------------

    /// Spawn a new PTY session for the given `pane_id`.
    ///
    /// Emits `vibe99:terminal-data` events with `{ paneId, data }` for
    /// each chunk of output, and `vibe99:terminal-exit` with
    /// `{ paneId, exitCode }` when the child process exits. On exit the
    /// session is automatically removed from the internal map, matching
    /// the Electron behaviour.
    ///
    /// If a session already exists for `pane_id` it is destroyed first.
    ///
    /// `shell_profile_id` overrides the default shell resolution: only
    /// the matching profile (and auto-detected fallbacks) are tried.
    pub fn spawn(
        self: &Arc<Self>,
        app: AppHandle,
        pane_id: &str,
        cols: Option<u16>,
        rows: Option<u16>,
        cwd: Option<&str>,
        shell_profile_id: Option<&str>,
    ) -> Result<(), String> {
        // Kill any previous session for this pane.
        self.destroy(pane_id);

        let pty_system = native_pty_system();
        let cwd = resolve_working_directory(cwd);
        let cols = cols.unwrap_or(DEFAULT_COLS).max(MIN_COLS);
        let rows = rows.unwrap_or(DEFAULT_ROWS).max(MIN_ROWS);

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("failed to open PTY: {e}"))?;

        // Build the shell command with fallback chain.
        let mut cmd = None;
        let mut last_error = String::new();

        for candidate in shell_candidates(&app, shell_profile_id) {
            match build_command(&candidate, &cwd) {
                Ok(c) => {
                    cmd = Some(c);
                    break;
                }
                Err(e) => {
                    last_error = e;
                }
            }
        }

        let mut cmd = cmd.ok_or_else(|| {
            if last_error.is_empty() {
                "No executable shell found".into()
            } else {
                last_error
            }
        })?;

        // Ensure colour support environment variables are set.
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("failed to spawn shell: {e}"))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("failed to clone PTY reader: {e}"))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("failed to get PTY writer: {e}"))?;

        let master = pair.master;

        // Clone a killer handle before moving the child into the exit task.
        let killer = child.clone_killer();

        let pane_id_owned = pane_id.to_string();

        // Read PTY output on a blocking thread and emit Tauri events.
        let app_reader = app.clone();
        let pane_id_reader = pane_id_owned.clone();
        let _reader_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        // Convert bytes to a UTF-8 string, replacing
                        // invalid sequences so the JSON payload stays
                        // valid. PTY output is almost always valid
                        // UTF-8, but binary garbage can appear.
                        let text = String::from_utf8_lossy(&buf[..n]);
                        let _ = app_reader.emit(
                            "vibe99:terminal-data",
                            TerminalDataPayload {
                                pane_id: pane_id_reader.clone(),
                                data: text.into_owned(),
                            },
                        );
                    }
                    Err(_) => {
                        // Reader errors (e.g. EIO when the child
                        // exits) are expected – treat as EOF.
                        break;
                    }
                }
            }
        });

        // Watch for child exit on a blocking thread. Emit the exit event
        // and remove the session from the map, matching Electron behaviour.
        let manager = Arc::clone(self);
        let _exit_thread = std::thread::spawn(move || {
            let exit_code = child.wait().map(|s| s.exit_code()).unwrap_or(1);

            // Emit the exit event before removing the session so the
            // frontend always receives it.
            let _ = app.emit(
                "vibe99:terminal-exit",
                TerminalExitPayload {
                    pane_id: pane_id_owned.clone(),
                    exit_code,
                },
            );

            // Remove the session from the map (matches Electron's
            // `terminalSessions.delete(paneId)`).
            if let Ok(mut sessions) = manager.sessions.lock() {
                sessions.remove(&pane_id_owned);
            }
        });

        let session = PtySession {
            master,
            writer,
            killer,
            _reader_thread,
            _exit_thread,
        };

        self.sessions
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?
            .insert(pane_id.to_string(), session);

        Ok(())
    }

    /// Write raw bytes to the PTY master for the given `pane_id`.
    pub fn write(&self, pane_id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;

        let session = sessions
            .get_mut(pane_id)
            .ok_or_else(|| format!("no session for pane {pane_id}"))?;

        session
            .writer
            .write_all(data)
            .map_err(|e| format!("write to PTY failed: {e}"))?;

        session
            .writer
            .flush()
            .map_err(|e| format!("flush PTY failed: {e}"))?;

        Ok(())
    }

    /// Resize the PTY for the given `pane_id`. Column and row values are
    /// clamped to the configured minimums.
    pub fn resize(&self, pane_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;

        let session = sessions
            .get(pane_id)
            .ok_or_else(|| format!("no session for pane {pane_id}"))?;

        session
            .master
            .resize(PtySize {
                rows: rows.max(MIN_ROWS),
                cols: cols.max(MIN_COLS),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize failed: {e}"))?;

        Ok(())
    }

    /// Kill the child process and remove the session for `pane_id`.
    pub fn destroy(&self, pane_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(mut session) = sessions.remove(pane_id) {
                let _ = session.killer.kill();
            }
        }
    }

    /// Destroy all active sessions.
    pub fn destroy_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for session in sessions.values_mut() {
                let _ = session.killer.kill();
            }
            sessions.clear();
        }
    }
}

// ----------------------------------------------------------------
// Shell resolution
// ----------------------------------------------------------------

/// Return the ordered list of shell candidates for spawning a PTY.
///
/// Priority:
/// 1. Default profile from settings (if configured and valid).
/// 2. Remaining profiles from settings (if any).
/// 3. Auto-detected platform fallbacks including WSL (always appended as safety net).
///
/// When `shell_profile_id` is `Some(id)`, only the matching profile is
/// tried (with auto-detected fallbacks as safety net), bypassing the
/// normal priority order.
fn shell_candidates(app: &AppHandle, shell_profile_id: Option<&str>) -> Vec<ShellCandidate> {
    let mut candidates: Vec<ShellCandidate> = Vec::new();
    let mut seen: HashSet<(PathBuf, Option<String>)> = HashSet::new();

    if let Ok(config) = load_settings_config(app) {
        let profiles = extract_profiles(&config);
        let default_id = extract_default_profile(&config);

        // If a specific profile is requested, use only that one.
        if let Some(requested_id) = shell_profile_id {
            if let Some(profile) = profiles.iter().find(|p| p.id == requested_id) {
                let path = PathBuf::from(&profile.command);
                if seen.insert((path.clone(), None)) {
                    candidates.push(ShellCandidate {
                        shell: path,
                        args: profile.args.clone(),
                        display_name: None,
                    });
                }
            }
        } else {
            // Normal priority: default profile first, then the rest.
            let ordered: Vec<_> = profiles
                .iter()
                .filter(|p| p.id != default_id)
                .chain(profiles.iter().filter(|p| p.id == default_id))
                .collect();

            for profile in ordered.into_iter().rev() {
                let path = PathBuf::from(&profile.command);
                if seen.insert((path.clone(), None)) {
                    candidates.push(ShellCandidate {
                        shell: path,
                        args: profile.args.clone(),
                        display_name: None,
                    });
                }
            }
        }
    }

    // Auto-detected fallbacks.
    let detected = auto_detected_candidates();

    // If a specific profile was requested but not found in settings,
    // try to match it against auto-detected candidates by id.
    if let Some(requested_id) = shell_profile_id {
        if candidates.is_empty() {
            let requested_lower = requested_id.to_lowercase();
            for candidate in &detected {
                // Match by display_name-derived id first, then by shell stem.
                let derived_id = candidate
                    .display_name
                    .as_ref()
                    .map(|d| display_name_to_id(d));
                let matches_display = derived_id.as_deref() == Some(&requested_lower);
                let stem = candidate
                    .shell
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default()
                    .to_lowercase();
                if matches_display || stem == requested_lower {
                    if seen.insert((candidate.shell.clone(), candidate.display_name.clone())) {
                        candidates.push(ShellCandidate {
                            shell: candidate.shell.clone(),
                            args: candidate.args.clone(),
                            display_name: candidate.display_name.clone(),
                        });
                    }
                    break;
                }
            }
        }
    }

    // Append remaining auto-detected fallbacks (deduplicated).
    for candidate in detected {
        if seen.insert((candidate.shell.clone(), candidate.display_name.clone())) {
            candidates.push(candidate);
        }
    }

    candidates
}

/// Load and sanitize settings from disk.
fn load_settings_config(app: &AppHandle) -> Result<serde_json::Value, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join("settings.json");

    if !path.exists() {
        return Err("no settings file".into());
    }

    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("failed to read settings: {e}"))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&contents).unwrap_or(serde_json::Value::Null);

    // Reuse the same sanitization as the settings command layer.
    Ok(crate::commands::settings::sanitize_config(&parsed))
}

/// Extract shell profiles from a sanitized config value.
fn extract_profiles(config: &serde_json::Value) -> Vec<crate::commands::settings::ShellProfile> {
    config
        .get("shell")
        .and_then(|s| s.get("profiles"))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

/// Extract the default profile id from a sanitized config value.
fn extract_default_profile(config: &serde_json::Value) -> String {
    config
        .get("shell")
        .and_then(|s| s.get("defaultProfile"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

// ----------------------------------------------------------------
// Auto-detection fallback
// ----------------------------------------------------------------

/// Return platform-specific shell candidates via environment inspection.
///
/// This is the fallback chain used when no profiles are configured in
/// settings, or when all configured profiles fail to resolve.
/// On Windows, WSL shells are offered after native Windows shells.
pub fn auto_detected_candidates() -> Vec<ShellCandidate> {
    let mut candidates: Vec<ShellCandidate> = Vec::new();

    if cfg!(target_os = "windows") {
        // Windows: check custom env, then PowerShell, then pwsh, then
        // ComSpec, then cmd.exe, then WSL (if available).
        if let Ok(custom) = std::env::var("VIBE99_WINDOWS_SHELL") {
            if !custom.is_empty() {
                // Special case: "wsl.exe" triggers WSL detection.
                if custom.eq_ignore_ascii_case("wsl.exe") {
                    push_wsl_candidates(&mut candidates, None);
                } else {
                    candidates.push(ShellCandidate {
                        shell: PathBuf::from(&custom),
                        args: vec![],
                        display_name: None,
                    });
                }
            }
        }
        for shell in &["powershell.exe", "pwsh.exe", "cmd.exe"] {
            candidates.push(ShellCandidate {
                shell: PathBuf::from(shell),
                args: vec![],
                display_name: None,
            });
        }
        if let Ok(comspec) = std::env::var("ComSpec") {
            if !comspec.is_empty() {
                candidates.push(ShellCandidate {
                    shell: PathBuf::from(&comspec),
                    args: vec![],
                    display_name: None,
                });
            }
        }
        // Append WSL candidates after native Windows shells.
        push_wsl_candidates(&mut candidates, None);
    } else {
        // Unix (Linux / macOS): $SHELL first (only if absolute), then
        // platform-specific fallbacks, deduplicated.
        let mut seen = HashSet::new();

        if let Ok(shell) = std::env::var("SHELL") {
            let p = PathBuf::from(&shell);
            if p.is_absolute() && seen.insert(p.clone()) {
                candidates.push(ShellCandidate {
                    shell: p,
                    args: vec!["-il".into()],
                    display_name: None,
                });
            }
        }

        let fallbacks: &[&str] = if cfg!(target_os = "macos") {
            &["/bin/zsh", "/bin/bash", "/bin/sh"]
        } else {
            &["/bin/bash", "/bin/sh"]
        };

        for shell in fallbacks {
            let p = PathBuf::from(shell);
            if seen.insert(p.clone()) && is_executable(&p) {
                candidates.push(ShellCandidate {
                    shell: p,
                    args: vec!["-il".into()],
                    display_name: None,
                });
            }
        }
    }

    candidates
}

/// Append WSL shell candidates to the list — one per detected distribution.
///
/// On non-Windows or when WSL is not available this is a no-op.
/// `distro_override` allows forcing a specific distribution (used by
/// `VIBE99_WINDOWS_SHELL=wsl.exe`).
#[cfg(target_os = "windows")]
fn push_wsl_candidates(candidates: &mut Vec<ShellCandidate>, distro_override: Option<&str>) {
    if !wsl::is_wsl_available() {
        return;
    }

    let default_shell = wsl::detect_wsl_default_shell().unwrap_or_else(|| "/bin/bash".into());

    if let Some(distro) = distro_override {
        let args = wsl::wsl_shell_args(Some(distro), &default_shell, &["-il".into()]);
        candidates.push(ShellCandidate {
            shell: PathBuf::from("wsl.exe"),
            args,
            display_name: Some(format!("WSL ({})", distro)),
        });
        return;
    }

    let distros = wsl::list_distributions();
    for distro in &distros {
        let args = wsl::wsl_shell_args(Some(distro), &default_shell, &["-il".into()]);
        candidates.push(ShellCandidate {
            shell: PathBuf::from("wsl.exe"),
            args,
            display_name: Some(format!("WSL ({})", distro)),
        });
    }
}

#[cfg(not(target_os = "windows"))]
fn push_wsl_candidates(_candidates: &mut Vec<ShellCandidate>, _distro_override: Option<&str>) {}

/// Build a `CommandBuilder` for a shell candidate. Returns an error if
/// the candidate binary does not exist or is not executable.
///
/// WSL candidates (shell == "wsl.exe") are handled specially: `wsl.exe`
/// is verified on the Windows side, but the inner shell (e.g. `/bin/bash`)
/// is not checked since it lives inside the WSL filesystem. The `cwd` is
/// converted from Windows to WSL path format when the candidate is WSL.
fn build_command(candidate: &ShellCandidate, cwd: &Path) -> Result<CommandBuilder, String> {
    let is_wsl = cfg!(target_os = "windows")
        && candidate
            .shell
            .file_name()
            .is_some_and(|n| n.eq_ignore_ascii_case("wsl.exe"));

    if is_wsl {
        // Verify wsl.exe exists on the Windows PATH.
        let wsl_path = which("wsl.exe").ok_or("wsl.exe not found on PATH")?;

        let mut cmd = CommandBuilder::new(&wsl_path);
        cmd.args(&candidate.args);

        // Convert Windows cwd to WSL path if it looks like a Windows path.
        let cwd_str = cwd.to_string_lossy();
        if let Some(wsl_cwd) = wsl::windows_to_wsl_path(&cwd_str) {
            cmd.cwd(PathBuf::from(&wsl_cwd));
        } else {
            cmd.cwd(cwd);
        }

        // Set WSLENV so WSL forwards selected env vars from Windows.
        let wslenv = wsl::wslenv_value();
        cmd.env("WSLENV", wslenv);

        return Ok(cmd);
    }

    // Resolve bare names (e.g. "powershell.exe") via PATH lookup.
    let shell_path = if candidate.shell.is_absolute() {
        if !candidate.shell.exists() {
            return Err(format!("shell not found: {:?}", candidate.shell));
        }
        candidate.shell.clone()
    } else {
        which(&candidate.shell.to_string_lossy())
            .ok_or_else(|| format!("shell not found on PATH: {:?}", candidate.shell))?
    };

    if !is_executable(&shell_path) {
        return Err(format!("shell not executable: {:?}", shell_path));
    }

    let mut cmd = CommandBuilder::new(&shell_path);
    cmd.args(&candidate.args);
    cmd.cwd(cwd);
    Ok(cmd)
}

// ----------------------------------------------------------------
// Working directory resolution
// ----------------------------------------------------------------

/// Resolve the working directory for a new PTY session.
///
/// Mirrors `electron/main.js` → `getSpawnWorkingDirectory()`:
/// 1. Use the provided `cwd` if it is a valid directory.
/// 2. Fall back to the current working directory.
/// 3. Fall back to the user's home directory.
fn resolve_working_directory(cwd: Option<&str>) -> PathBuf {
    if let Some(cwd) = cwd {
        let p = PathBuf::from(cwd);
        if p.is_dir() {
            return p;
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        if cwd.is_dir() {
            return cwd;
        }
    }

    dirs_home().unwrap_or_else(|| PathBuf::from("/"))
}

/// Return the user's home directory.
fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/// Locate an executable on the system PATH.
///
/// Returns the full path if found, `None` otherwise. On Windows this also
/// checks the current directory and appends `.exe` if no extension is
/// present.
#[cfg(target_os = "windows")]
fn which(name: &str) -> Option<PathBuf> {
    // Check the bare name first (handles absolute paths).
    if Path::new(name).is_file() {
        return Some(PathBuf::from(name));
    }

    let exe_name = if name.ends_with(".exe") {
        name.to_string()
    } else {
        format!("{name}.exe")
    };

    // System PATH
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(';') {
            let candidate = PathBuf::from(dir).join(&exe_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
fn which(name: &str) -> Option<PathBuf> {
    if Path::new(name).is_file() {
        Some(PathBuf::from(name))
    } else {
        None
    }
}

/// Check whether a path refers to an executable file.
#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.is_file()
        && path
            .metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}
