//! Capture clipboard images once, then stage them beside the receiving TUI.
use crate::commands::terminal::AppState;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

const MAX_PNG: u64 = 16 * 1024 * 1024;
const UPLOAD: &str = include_str!("../../remote/store_clipboard_image.py");

fn image_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("clipboard-images");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn valid_image_id(id: &str) -> bool {
    id.starts_with("image-")
        && id.ends_with(".png")
        && id.len() < 100
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        && !id.contains("..")
}

#[tauri::command]
pub async fn clipboard_snapshot(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        json!({ "text": app.clipboard().read_text().unwrap_or_default(),
            "hasImage": app.clipboard().read_image().is_ok() })
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clipboard_capture(app: AppHandle, image_only: bool) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let image = match app.clipboard().read_image() {
            Ok(image) => image,
            Err(_) => return Ok(json!({"text": if image_only { String::new() } else { app.clipboard().read_text().unwrap_or_default() }})),
        };
        let pixels = u64::from(image.width()) * u64::from(image.height());
        if pixels == 0 || pixels > 32 * 1024 * 1024 || image.rgba().len() as u64 != pixels * 4 {
            return Err("Clipboard image exceeds 32 megapixels or has invalid dimensions".into());
        }
        let root = image_root(&app)?;
        // Keep pasted files across app exits/tmux detach. Reclaim only our old PNGs.
        for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
            if !valid_image_id(&entry.file_name().to_string_lossy()) { continue; }
            if let Ok(meta) = entry.path().symlink_metadata() {
                if meta.file_type().is_file() && meta.modified().ok().and_then(|t| SystemTime::now().duration_since(t).ok())
                    .is_some_and(|age| age > Duration::from_secs(7 * 86400)) {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
        let mut file = tempfile::Builder::new().prefix("image-").suffix(".png").tempfile_in(root).map_err(|e| e.to_string())?;
        {
            let mut encoder = png::Encoder::new(file.as_file_mut(), image.width(), image.height());
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
            writer.write_image_data(image.rgba()).map_err(|e| e.to_string())?;
        }
        if file.as_file().metadata().map_err(|e| e.to_string())?.len() > MAX_PNG {
            return Err("Clipboard PNG exceeds 16 MiB".into());
        }
        let (_, path) = file.keep().map_err(|e| e.to_string())?;
        Ok(json!({"imageId": path.file_name().unwrap().to_string_lossy()}))
    }).await.map_err(|e| e.to_string())?
}

fn upload(path: &Path, target: &str) -> Result<String, String> {
    if target.is_empty()
        || target.starts_with('-')
        || target.len() > 512
        || !target
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-@:[]".contains(&b))
    {
        return Err("Use a configured SSH alias or user@host".into());
    }
    let code = STANDARD.encode(UPLOAD);
    let remote = format!("python3 -c 'import base64;exec(compile(base64.b64decode(\"{code}\"),\"vibe99_image_upload\",\"exec\"))'");
    let mut output = tempfile::tempfile().map_err(|e| e.to_string())?;
    let errors = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut command = Command::new("ssh");
    command
        .args([
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ServerAliveInterval=5",
            "-o",
            "ServerAliveCountMax=2",
            "--",
            target,
            &remote,
        ])
        .stdin(Stdio::from(
            fs::File::open(path).map_err(|e| e.to_string())?,
        ))
        .stdout(output.try_clone().map_err(|e| e.to_string())?)
        .stderr(errors.try_clone().map_err(|e| e.to_string())?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Cannot start image transfer: {e}"))?;
    let started = Instant::now();
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                break if status.success() {
                    Ok(())
                } else {
                    Err("SSH image transfer failed".to_string())
                }
            }
            Err(error) => break Err(error.to_string()),
            Ok(None) => {}
        }
        if started.elapsed() > Duration::from_secs(25) {
            break Err("SSH image transfer timed out".into());
        }
        if output.metadata().map(|m| m.len()).unwrap_or(u64::MAX) > 8192
            || errors.metadata().map(|m| m.len()).unwrap_or(u64::MAX) > 65536
        {
            break Err("SSH image transfer returned too much output".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    if result.is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
    result?;
    output.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut value = String::new();
    output
        .take(8193)
        .read_to_string(&mut value)
        .map_err(|e| e.to_string())?;
    let value = value.trim();
    if value.len() > 4096
        || !value.starts_with('/')
        || value.contains(char::is_control)
        || !value.ends_with(".png")
        || value.contains(['\'', '"', '`', '$', '\\'])
    {
        return Err("SSH returned an invalid image path".into());
    }
    Ok(value.to_string())
}

#[tauri::command]
pub async fn terminal_image_path(
    app: AppHandle,
    state: State<'_, AppState>,
    pane_id: String,
    session_id: String,
    image_id: String,
    target: Option<String>,
) -> Result<String, String> {
    let manager = state.pty.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let pid = manager
            .preview_process_id(&pane_id, &session_id)
            .ok_or("Terminal session ended")?;
        if !valid_image_id(&image_id) {
            return Err("Invalid clipboard image ID".into());
        }
        let root = image_root(&app)?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let path = root
            .join(image_id)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if path.parent() != Some(root.as_path())
            || !path.is_file()
            || fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_PNG
        {
            return Err("Clipboard image is unavailable".into());
        }
        let result = match target {
            Some(target) => upload(&path, &target)?,
            None => path
                .to_string_lossy()
                .trim_start_matches(r"\\?\")
                .replace('\\', "/"),
        };
        if manager.preview_process_id(&pane_id, &session_id) != Some(pid) {
            return Err("Terminal session changed during paste".into());
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_owned_image_names() {
        assert!(valid_image_id("image-AbC123.png"));
        for name in [
            "../image-a.png",
            "image-../secret.png",
            "image-a/b.png",
            "x.png",
            "image-a.png\n",
        ] {
            assert!(!valid_image_id(name));
        }
    }
}
