use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Minimum column count for a PTY session.
const MIN_COLS: u16 = 20;

/// Minimum row count for a PTY session.
const MIN_ROWS: u16 = 8;

/// Default column count when none is specified.
const DEFAULT_COLS: u16 = 80;

/// Default row count when none is specified.
const DEFAULT_ROWS: u16 = 24;

/// A shell candidate for the fallback chain.
struct ShellCandidate {
    shell: PathBuf,
    args: Vec<String>,
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
    pub fn spawn(
        self: &Arc<Self>,
        app: AppHandle,
        pane_id: &str,
        cols: Option<u16>,
        rows: Option<u16>,
        cwd: Option<&str>,
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

        for candidate in shell_candidates() {
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
// Shell detection
// ----------------------------------------------------------------

/// Return the ordered list of shell candidates, mirroring the fallback
/// chain in `electron/main.js` → `getShellLaunchConfigs()`.
fn shell_candidates() -> Vec<ShellCandidate> {
    let mut candidates: Vec<ShellCandidate> = Vec::new();

    if cfg!(target_os = "windows") {
        // Windows: check custom env, then PowerShell, then pwsh, then
        // ComSpec, then cmd.exe.
        if let Ok(custom) = std::env::var("VIBE99_WINDOWS_SHELL") {
            if !custom.is_empty() {
                candidates.push(ShellCandidate {
                    shell: PathBuf::from(&custom),
                    args: vec![],
                });
            }
        }
        for shell in &["powershell.exe", "pwsh.exe", "cmd.exe"] {
            candidates.push(ShellCandidate {
                shell: PathBuf::from(shell),
                args: vec![],
            });
        }
        if let Ok(comspec) = std::env::var("ComSpec") {
            if !comspec.is_empty() {
                candidates.push(ShellCandidate {
                    shell: PathBuf::from(&comspec),
                    args: vec![],
                });
            }
        }
    } else {
        // Unix (Linux / macOS): $SHELL first (only if absolute), then
        // platform-specific fallbacks, deduplicated.
        let mut seen = std::collections::HashSet::new();

        if let Ok(shell) = std::env::var("SHELL") {
            let p = PathBuf::from(&shell);
            if p.is_absolute() && seen.insert(p.clone()) {
                candidates.push(ShellCandidate {
                    shell: p,
                    args: vec!["-il".into()],
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
                });
            }
        }
    }

    candidates
}

/// Build a `CommandBuilder` for a shell candidate. Returns an error if
/// the candidate binary does not exist or is not executable.
fn build_command(candidate: &ShellCandidate, cwd: &Path) -> Result<CommandBuilder, String> {
    if !candidate.shell.exists() {
        return Err(format!("shell not found: {:?}", candidate.shell));
    }
    if !is_executable(&candidate.shell) {
        return Err(format!("shell not executable: {:?}", candidate.shell));
    }

    let mut cmd = CommandBuilder::new(&candidate.shell);
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
