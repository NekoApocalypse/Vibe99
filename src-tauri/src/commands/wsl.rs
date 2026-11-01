use serde::Serialize;

use crate::wsl;

/// WSL status returned to the frontend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslStatus {
    available: bool,
    distributions: Vec<String>,
    default_shell: Option<String>,
}

/// Check WSL availability and return distribution info.
///
/// Always returns `available: false` on non-Windows platforms.
#[tauri::command]
pub async fn wsl_status() -> Result<WslStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let distributions = wsl::discover_distributions()?;
        Ok(WslStatus { available: !distributions.is_empty(), distributions, default_shell: None })
    }).await.map_err(|e| e.to_string())?
}

/// Convert a Windows path to its WSL equivalent.
///
/// Returns the converted path or the original input unchanged if it
/// does not look like a Windows path.
#[tauri::command]
pub fn wsl_convert_path(windows_path: String) -> Result<String, String> {
    wsl::windows_to_wsl_path(&windows_path)
        .ok_or_else(|| format!("cannot convert path: {windows_path}"))
}

/// Get the current working directory, converting to WSL path format
/// when running under WSL.
#[tauri::command]
pub fn wsl_cwd() -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|e| format!("failed to get cwd: {e}"))?;
    let cwd_str = cwd.display().to_string();

    // Pure conversion: asking for a path must never start WSL discovery.
    if cfg!(target_os = "windows") {
        if let Some(wsl_path) = wsl::windows_to_wsl_path(&cwd_str) {
            return Ok(wsl_path);
        }
    }

    Ok(cwd_str)
}
