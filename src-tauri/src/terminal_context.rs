//! Optional, read-only inspection of the process tree owned by one terminal.
use crate::commands::terminal::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewContext {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}
impl PreviewContext {
    fn unknown(reason: impl Into<String>) -> Self {
        Self {
            kind: "unknown",
            target: None,
            reason: Some(reason.into()),
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    name: String,
    command_line: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    root_present: bool,
    truncated: bool,
    candidates: Vec<Candidate>,
}

fn simple_target(args: &[String]) -> Option<String> {
    let tail = args.get(1..)?;
    let target = match tail {
        [target] => target,
        [separator, target] if separator == "--" => target,
        _ => return None,
    };
    // Intentionally reject all options and remote commands: reproducing only a
    // destination would silently discard custom identities, ports or jump hosts.
    if target.is_empty()
        || target.starts_with('-')
        || target.len() > 512
        || !target
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-@:[]".contains(&b))
    {
        return None;
    }
    Some(target.clone())
}
fn classify(
    snapshot: Snapshot,
    parse: impl Fn(&str) -> Result<Vec<String>, String>,
) -> PreviewContext {
    if !snapshot.root_present {
        return PreviewContext::unknown("The terminal process ended during inspection");
    }
    if snapshot.truncated {
        return PreviewContext::unknown("The terminal process tree exceeds inspection limits");
    }
    if snapshot.candidates.is_empty() {
        return PreviewContext {
            kind: "local",
            target: None,
            reason: None,
        };
    }
    if snapshot.candidates.len() != 1 {
        return PreviewContext::unknown(
            "Multiple or nested remote processes need an explicit preview connection",
        );
    }
    let candidate = &snapshot.candidates[0];
    if !candidate.name.eq_ignore_ascii_case("ssh.exe") {
        return PreviewContext::unknown(
            "This remote terminal type needs an explicit preview connection",
        );
    }
    let Some(command) = candidate.command_line.as_deref() else {
        return PreviewContext::unknown("The SSH command line is unavailable");
    };
    let Ok(args) = parse(command) else {
        return PreviewContext::unknown("The SSH command line could not be decoded");
    };
    match simple_target(&args) {
        Some(target) => PreviewContext {
            kind: "ssh",
            target: Some(target),
            reason: None,
        },
        None => PreviewContext::unknown(
            "SSH options or a remote command need an explicit preview connection",
        ),
    }
}

#[cfg(windows)]
fn windows_arguments(command: &str) -> Result<Vec<String>, String> {
    use std::ffi::c_void;
    #[link(name = "shell32")]
    extern "system" {
        fn CommandLineToArgvW(command: *const u16, count: *mut i32) -> *mut *mut u16;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }
    if command.is_empty() || command.contains('\0') || command.encode_utf16().count() > 32767 {
        return Err("Invalid command line".into());
    }
    let wide: Vec<u16> = command.encode_utf16().chain(Some(0)).collect();
    let mut count = 0;
    // The Windows parser owns this allocation; all strings are copied before
    // LocalFree. The OS API guarantees terminated strings and count entries.
    unsafe {
        let argv = CommandLineToArgvW(wide.as_ptr(), &mut count);
        if argv.is_null() {
            return Err("Windows command-line parsing failed".into());
        }
        let result = if count < 1 || count > 1024 {
            Err("Too many command arguments".into())
        } else {
            let mut args = Vec::new();
            for pointer in std::slice::from_raw_parts(argv, count as usize) {
                let mut length = 0;
                while *pointer.add(length) != 0 {
                    length += 1;
                }
                args.push(String::from_utf16_lossy(std::slice::from_raw_parts(
                    *pointer, length,
                )));
            }
            Ok(args)
        };
        LocalFree(argv.cast());
        result
    }
}

#[cfg(windows)]
fn inspect(pid: u32) -> PreviewContext {
    use std::{
        io::{Read, Seek, SeekFrom},
        os::windows::process::CommandExt,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    fn snapshot(pid: u32) -> Result<Snapshot, String> {
        let script = r#"
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$rootId=ROOT_PID
$all=@(Get-CimInstance Win32_Process -OperationTimeoutSec 2)
if($all.Count -gt 8192){throw 'Process snapshot exceeds limits'}
$root=@($all | Where-Object {$_.ProcessId -eq $rootId})
if($root.Count -ne 1){[Console]::Write('{"rootPresent":false,"truncated":false,"candidates":[]}');exit}
$owned=@{};$owned[[uint32]$rootId]=$root[0]
$truncated=$false
for($depth=0;$depth -lt 16;$depth++){
  $next=@($all | Where-Object {
    $parent=$owned[[uint32]$_.ParentProcessId]
    $parent -and -not $owned.ContainsKey([uint32]$_.ProcessId) -and $_.CreationDate -ge $parent.CreationDate
  })
  if($next.Count -eq 0){break}
  if($owned.Count+$next.Count -gt 128){$truncated=$true;break}
  foreach($item in $next){$owned[[uint32]$item.ProcessId]=$item}
  if($depth -eq 15){$truncated=$true}
}
$remoteCandidates=@($owned.Values | Where-Object {$_.Name -match '^(ssh|plink|putty|wsl|bash|mosh|docker|kubectl)(\.exe)?$'} | ForEach-Object {
  @{name=$_.Name;commandLine=$_.CommandLine}
})
[Console]::Write((@{rootPresent=$true;truncated=$truncated;candidates=$remoteCandidates} | ConvertTo-Json -Compress -Depth 4))
"#.replace("ROOT_PID", &pid.to_string());
        let powershell = std::path::PathBuf::from(
            std::env::var_os("SystemRoot").ok_or("Windows directory unavailable")?,
        )
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut output = tempfile::tempfile().map_err(|e| e.to_string())?;
        let mut child = Command::new(powershell)
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &script,
            ])
            .stdin(Stdio::null())
            .stdout(output.try_clone().map_err(|e| e.to_string())?)
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|_| "Cannot start terminal inspection")?;
        let started = Instant::now();
        let result = loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => break Ok(()),
                Ok(Some(_)) => break Err("Terminal process inspection failed"),
                Err(_) => break Err("Terminal inspection status unavailable"),
                Ok(None) => {}
            }
            if started.elapsed() >= Duration::from_secs(3) {
                break Err("Terminal process inspection timed out");
            }
            if output.metadata().map(|m| m.len()).unwrap_or(u64::MAX) > 256 * 1024 {
                break Err("Terminal inspection output exceeds limits");
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        if result.is_err() {
            let _ = child.kill();
        }
        let _ = child.wait();
        result?;
        output.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        output
            .take(256 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 256 * 1024 {
            return Err("Terminal inspection output exceeds limits".into());
        }
        serde_json::from_slice(&bytes).map_err(|_| "Terminal inspection response is invalid".into())
    }
    match snapshot(pid) {
        Ok(snapshot) => classify(snapshot, windows_arguments),
        Err(error) => PreviewContext::unknown(error),
    }
}
#[cfg(not(windows))]
fn inspect(_: u32) -> PreviewContext {
    PreviewContext::unknown("Automatic terminal connection detection is available on Windows")
}

#[tauri::command]
pub async fn terminal_preview_context(
    state: State<'_, AppState>,
    pane_id: String,
    session_id: String,
) -> Result<PreviewContext, String> {
    let manager = state.pty.clone();
    let Some(pid) = manager.preview_process_id(&pane_id, &session_id) else {
        return Ok(PreviewContext::unknown(
            "The terminal session is no longer active",
        ));
    };
    Ok(tauri::async_runtime::spawn_blocking(move || {
        let context = inspect(pid);
        if manager.preview_process_id(&pane_id, &session_id) != Some(pid) {
            PreviewContext::unknown("The terminal session changed during inspection")
        } else {
            context
        }
    })
    .await
    .unwrap_or_else(|_| PreviewContext::unknown("Terminal process inspection failed")))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| v.to_string()).collect()
    }
    #[test]
    fn accepts_only_simple_ssh_destinations() {
        assert_eq!(
            simple_target(&args(&["ssh.exe", "dev@192.0.2.10"])),
            Some("dev@192.0.2.10".into())
        );
        assert_eq!(
            simple_target(&args(&["ssh.exe", "--", "work-alias"])),
            Some("work-alias".into())
        );
        for values in [
            &["ssh.exe", "-p", "2222", "host"][..],
            &["ssh.exe", "host", "tmux"],
            &["ssh.exe", "-Jjump", "host"],
            &["ssh.exe", "-i", "key", "host"],
            &["ssh.exe", "bad host"],
            &["ssh.exe", "-host"],
        ] {
            assert_eq!(simple_target(&args(values)), None);
        }
    }
    #[test]
    fn ambiguous_or_unavailable_snapshots_are_unknown() {
        let make = |names: &[&str]| Snapshot {
            root_present: true,
            truncated: false,
            candidates: names
                .iter()
                .map(|name| Candidate {
                    name: name.to_string(),
                    command_line: Some("ssh.exe host".into()),
                })
                .collect(),
        };
        assert_eq!(classify(make(&[]), |_| Ok(vec![])).kind, "local");
        assert_eq!(
            classify(make(&["ssh.exe", "ssh.exe"]), |_| Ok(vec![])).kind,
            "unknown"
        );
        assert_eq!(classify(make(&["wsl.exe"]), |_| Ok(vec![])).kind, "unknown");
        assert_eq!(
            classify(make(&["ssh.exe"]), |_| Ok(args(&["ssh.exe", "alias"]))).target,
            Some("alias".into())
        );
        let mut missing = make(&[]);
        missing.root_present = false;
        assert_eq!(classify(missing, |_| Ok(vec![])).kind, "unknown");
        let mut limited = make(&[]);
        limited.truncated = true;
        assert_eq!(classify(limited, |_| Ok(vec![])).kind, "unknown");
    }
    #[cfg(windows)]
    #[test]
    fn native_windows_parser_preserves_quoted_arguments() {
        let parsed =
            windows_arguments(r#""C:\Program Files\OpenSSH\ssh.exe" "dev@192.0.2.10""#).unwrap();
        assert_eq!(
            parsed,
            args(&[r"C:\Program Files\OpenSSH\ssh.exe", "dev@192.0.2.10"])
        );
        let parsed =
            windows_arguments(r#"ssh.exe -i "C:\keys with spaces\id_ed25519" host"#).unwrap();
        assert_eq!(parsed[2], r"C:\keys with spaces\id_ed25519");
        assert_eq!(simple_target(&parsed), None);
        assert!(windows_arguments("ssh.exe\0host").is_err());
    }
}
