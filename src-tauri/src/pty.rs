use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

use crate::output_flow::OutputFlow;
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
    session_id: String,
    sequence: u64,
    data: String,
}

/// Returns the index of the last complete UTF-8 character boundary in
/// `buf`. Bytes after this point form an incomplete multi-byte sequence
/// and should be carried over to the next read. Returns `buf.len()` when
/// the buffer already ends on a complete boundary.
fn utf8_safe_cut(buf: &[u8]) -> usize {
    let len = buf.len();
    if len == 0 {
        return 0;
    }

    // Walk backwards past continuation bytes (10xxxxxx) to find the leading byte.
    let mut i = len - 1;
    while i > 0 && buf[i] & 0xC0 == 0x80 {
        i -= 1;
    }

    let expected: usize = match buf[i] {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF7 => 4,
        _ => return len, // invalid leading byte – flush as-is
    };

    let actual = len - i;
    if actual >= expected {
        len
    } else {
        i
    }
}

/// Payload emitted on `vibe99:terminal-exit`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    pane_id: String,
    session_id: String,
    exit_code: u32,
}

/// Holds the live resources for a single PTY session.
struct PtySession {
    session_id: String,
    process_id: Option<u32>,
    process_exited: Arc<AtomicBool>,
    flow: Arc<OutputFlow>,
    /// The master end of the PTY pair. Kept alive so the child process
    /// has a valid controlling terminal. Dropping this causes the child
    /// to receive SIGHUP.
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    /// Writer to the PTY master (stdin of the child process).
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// Killer handle to terminate the child process.
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// Manages a collection of PTY sessions keyed by pane ID.
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
    shutting_down: AtomicBool,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            shutting_down: AtomicBool::new(false),
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
        session_id: &str,
        cols: Option<u16>,
        rows: Option<u16>,
        cwd: Option<&str>,
        shell_profile_id: Option<&str>,
    ) -> Result<(), String> {
        if self.shutting_down.load(Ordering::Acquire) {
            return Err("application is closing".into());
        }
        // Kill any previous session for this pane.
        self.destroy(pane_id, None);

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
        // Captured and removed by the original local PowerShell prompt wrapper,
        // so nested shells and foreground TUIs cannot inherit its prompt marker.
        cmd.env("VIBE99_PROMPT_TOKEN", session_id);

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
        let process_id = child.process_id();
        let process_exited = Arc::new(AtomicBool::new(false));

        let pane_id_owned = pane_id.to_string();
        let session_id_owned = session_id.to_string();
        let flow = Arc::new(OutputFlow::default());
        let mut session = PtySession {
            session_id: session_id_owned.clone(),
            process_id,
            process_exited: process_exited.clone(),
            flow: flow.clone(),
            master: Arc::new(Mutex::new(Some(master))),
            writer: Arc::new(Mutex::new(writer)),
            killer,
        };
        // Publish the generation before starting either worker: very short-lived
        // shells can otherwise exit before their session is registered.
        {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            if self.shutting_down.load(Ordering::Acquire) {
                let _ = session.killer.kill();
                return Err("application is closing".into());
            }
            sessions.insert(pane_id.to_string(), session);
        }
        drop(pair.slave);

        let app_reader = app.clone();
        let pane_id_reader = pane_id_owned.clone();
        let session_id_reader = session_id_owned.clone();
        let reader_flow = flow.clone();
        let reader_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut pending = Vec::with_capacity(8196);
            let emit = |data: String| {
                // After explicit close, keep draining the pipe without emitting.
                // ClosePseudoConsole can wait for its output pipe to drain.
                let Some(sequence) = reader_flow.reserve(data.len()) else {
                    return;
                };
                if app_reader
                    .emit(
                        "vibe99:terminal-data",
                        TerminalDataPayload {
                            pane_id: pane_id_reader.clone(),
                            session_id: session_id_reader.clone(),
                            sequence,
                            data,
                        },
                    )
                    .is_err()
                {
                    reader_flow.cancel();
                }
            };
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => {
                        if !pending.is_empty() {
                            emit(String::from_utf8_lossy(&pending).into_owned());
                        }
                        break;
                    }
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        let cut = utf8_safe_cut(&pending);
                        if cut > 0 {
                            emit(String::from_utf8_lossy(&pending[..cut]).into_owned());
                            pending.drain(..cut);
                        }
                    }
                }
            }
        });

        let manager = Arc::clone(self);
        std::thread::spawn(move || {
            let exit_code = child.wait().map(|s| s.exit_code()).unwrap_or(1);
            process_exited.store(true, Ordering::Release);
            // Closing ConPTY makes its output reader reach EOF. Keep the flow
            // entry available for ACKs while the final output drains, and never
            // hold the map mutex during ClosePseudoConsole (it can block).
            let master = manager.sessions.lock().ok().and_then(|sessions| {
                sessions
                    .get(&pane_id_owned)
                    .filter(|s| s.session_id == session_id_owned)
                    .map(|s| s.master.clone())
            });
            if let Some(master) = master {
                let closing = master.lock().ok().and_then(|mut master| master.take());
                drop(closing);
            }
            // Preserve tail output before publishing exit. Explicit destruction
            // cancels credits and closes the master, allowing the reader to leave.
            let _ = reader_thread.join();
            let _ = app.emit(
                "vibe99:terminal-exit",
                TerminalExitPayload {
                    pane_id: pane_id_owned.clone(),
                    session_id: session_id_owned.clone(),
                    exit_code,
                },
            );
            if let Ok(mut sessions) = manager.sessions.lock() {
                if sessions
                    .get(&pane_id_owned)
                    .is_some_and(|s| s.session_id == session_id_owned)
                {
                    sessions.remove(&pane_id_owned);
                }
            }
            flow.cancel();
        });
        Ok(())
    }

    /// Return only the live process owned by this exact pane generation.
    pub fn preview_process_id(&self, pane_id: &str, session_id: &str) -> Option<u32> {
        self.sessions.lock().ok()?.get(pane_id)
            .filter(|session| session.session_id == session_id && !session.process_exited.load(Ordering::Acquire))
            .and_then(|session| session.process_id)
    }

    pub fn acknowledge(&self, pane_id: &str, session_id: &str, sequence: u64) {
        let flow = self.sessions.lock().ok().and_then(|sessions| {
            sessions
                .get(pane_id)
                .filter(|s| s.session_id == session_id)
                .map(|s| s.flow.clone())
        });
        if let Some(flow) = flow {
            flow.acknowledge(sequence);
        }
    }

    pub fn write(&self, pane_id: &str, session_id: &str, data: &[u8]) -> Result<(), String> {
        // A blocked write in one pane must not hold the map used by all panes.
        let writer = {
            let sessions = self
                .sessions
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            let Some(session) = sessions.get(pane_id).filter(|s| s.session_id == session_id) else {
                return Ok(()); // Input from a replaced/disposed generation.
            };
            session.writer.clone()
        };
        let mut writer = writer.lock().map_err(|e| format!("lock poisoned: {e}"))?;
        writer
            .write_all(data)
            .map_err(|e| format!("write to PTY failed: {e}"))?;
        writer.flush().map_err(|e| format!("flush PTY failed: {e}"))
    }

    pub fn resize(
        &self,
        pane_id: &str,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let master = {
            let sessions = self
                .sessions
                .lock()
                .map_err(|e| format!("lock poisoned: {e}"))?;
            let Some(session) = sessions.get(pane_id).filter(|s| s.session_id == session_id) else {
                return Ok(());
            };
            session.master.clone()
        };
        let master = master.lock().map_err(|e| format!("lock poisoned: {e}"))?;
        let Some(master) = &*master else {
            return Ok(());
        };
        master
            .resize(PtySize {
                rows: rows.max(MIN_ROWS),
                cols: cols.max(MIN_COLS),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize failed: {e}"))
    }

    /// Cancel blocked readers before killing the child. Do not join on the UI
    /// thread; the exit worker reaps the child and owns the reader's join handle.
    pub fn destroy(&self, pane_id: &str, session_id: Option<&str>) {
        let session = {
            let Ok(mut sessions) = self.sessions.lock() else {
                return;
            };
            if !sessions
                .get(pane_id)
                .is_some_and(|s| session_id.is_none_or(|id| id == s.session_id))
            {
                return;
            }
            sessions.remove(pane_id)
        };
        if let Some(mut session) = session {
            session.flow.cancel();
            std::thread::spawn(move || {
                let _ = session.killer.kill();
                drop(session);
            });
        }
    }

    pub fn destroy_all(&self) {
        self.shutting_down.store(true, Ordering::Release);
        let sessions = {
            let Ok(mut sessions) = self.sessions.lock() else {
                return;
            };
            std::mem::take(&mut *sessions)
        };
        for (_, mut session) in sessions {
            session.flow.cancel();
            std::thread::spawn(move || {
                let _ = session.killer.kill();
                drop(session);
            });
        }
    }
}

// ----------------------------------------------------------------
// Shell resolution
// ----------------------------------------------------------------

/// Return the ordered list of shell candidates for spawning a PTY.
///
/// Explicit and configured default profiles are used directly. Without a
/// selected profile, try native platform defaults. Discovery is never part of
/// shell resolution, and failure of a selected profile stays in its pane.
fn shell_candidates(app: &AppHandle, shell_profile_id: Option<&str>) -> Vec<ShellCandidate> {
    let config = load_settings_config(app).unwrap_or_default();
    resolve_shell_candidates(&config, shell_profile_id)
}

fn resolve_shell_candidates(config: &serde_json::Value, requested: Option<&str>) -> Vec<ShellCandidate> {
    // Recovery bypasses both the configured default and environment overrides.
    if requested == Some("__vibe99_local__") {
        let shells: &[&str] = if cfg!(target_os = "windows") {
            &["powershell.exe", "pwsh.exe", "cmd.exe"]
        } else {
            &["/bin/sh"]
        };
        return shells.iter().map(|shell| ShellCandidate {
            shell: PathBuf::from(shell), args: vec![], display_name: None,
        }).collect();
    }
    let profiles = extract_profiles(config);
    let default_id = extract_default_profile(config);
    let selected = requested.or_else(|| (!default_id.is_empty()).then_some(default_id.as_str()));
    let detected = auto_detected_candidates(); // Local inspection; never probes WSL.
    if let Some(id) = selected {
        if let Some(profile) = profiles.iter().find(|p| p.id == id) {
            return vec![ShellCandidate {
                shell: PathBuf::from(&profile.command), args: profile.args.clone(), display_name: None,
            }];
        }
        // Discovered distro profiles are saved before selection. Unknown explicit
        // profiles fail in their pane, never silently choose another shell.
        return detected.into_iter().filter(|c| {
            let derived = c.display_name.as_ref().map(|d| display_name_to_id(d));
            derived.as_deref() == Some(id) || c.shell.file_stem()
                .is_some_and(|stem| stem.to_string_lossy().eq_ignore_ascii_case(id))
        }).take(1).collect();
    }
    detected
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
/// settings.
/// WSL enumeration is deliberately excluded from this launch path.
pub fn auto_detected_candidates() -> Vec<ShellCandidate> {
    let mut candidates: Vec<ShellCandidate> = Vec::new();

    if cfg!(target_os = "windows") {
        // Windows: check custom env, then PowerShell, then pwsh, then
        // ComSpec, then cmd.exe. No external discovery runs here.
        if let Ok(custom) = std::env::var("VIBE99_WINDOWS_SHELL") {
            if !custom.is_empty() {
                candidates.push(ShellCandidate {
                    shell: PathBuf::from(&custom), args: vec![], display_name: None,
                });
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

/// Optional, bounded discovery, used only by the shell profile picker.
pub fn wsl_candidates() -> Result<Vec<ShellCandidate>, String> {
    let distros = wsl::discover_distributions()?;
    Ok(distros.into_iter().map(|distro| ShellCandidate {
        shell: wsl::launcher_path().unwrap_or_else(|| PathBuf::from("wsl.exe")),
        args: vec!["--distribution".into(), distro.clone()],
        display_name: Some(format!("WSL ({distro})")),
    }).collect())
}

/// Build a `CommandBuilder` for a shell candidate. Returns an error if
/// the candidate binary does not exist or is not executable.
///
/// WSL candidates (shell == "wsl.exe") are handled specially: `wsl.exe`
/// is verified on the Windows side, but the inner shell (e.g. `/bin/bash`)
/// is not checked since it lives inside the WSL filesystem. The host process
/// keeps a Windows cwd, which WSL translates when opening the Linux shell.
fn build_command(candidate: &ShellCandidate, cwd: &Path) -> Result<CommandBuilder, String> {
    let is_wsl = cfg!(target_os = "windows")
        && candidate
            .shell
            .file_name()
            .is_some_and(|n| n.eq_ignore_ascii_case("wsl.exe"));

    if is_wsl {
        let wsl_path = if candidate.shell.is_absolute() && candidate.shell.is_file() {
            candidate.shell.clone()
        } else {
            wsl::launcher_path().ok_or("WSL launcher was not found")?
        };
        let mut cmd = CommandBuilder::new(&wsl_path);
        // CreateProcess needs a Windows cwd. Let wsl.exe translate it; never
        // pass a Linux /mnt path as the host process working directory.
        cmd.cwd(cwd);
        cmd.args(&candidate.args);

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
    cmd.args(crate::shell_integration::args(&shell_path, &candidate.args));
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

#[cfg(test)]
mod startup_tests {
    use super::*;

    #[test]
    fn explicit_and_default_profiles_never_fall_back() {
        let config = serde_json::json!({ "shell": {
            "defaultProfile": "custom-wsl",
            "profiles": [{ "id": "custom-wsl", "command": "wsl.exe",
                "args": ["--distribution", "My Linux"] }]
        }});
        for requested in [None, Some("custom-wsl")] {
            let candidates = resolve_shell_candidates(&config, requested);
            assert_eq!(candidates.len(), 1);
            assert_eq!(candidates[0].args, ["--distribution", "My Linux"]);
        }
        assert!(resolve_shell_candidates(&config, Some("missing-profile")).is_empty());
        let local = resolve_shell_candidates(&config, Some("__vibe99_local__"));
        assert!(!local.is_empty());
        assert!(local.iter().all(|c| c.shell != PathBuf::from("wsl.exe")));
    }

    #[test]
    fn default_launch_needs_no_discovery() {
        let started = std::time::Instant::now();
        assert!(!resolve_shell_candidates(&serde_json::Value::Null, None).is_empty());
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }
}
