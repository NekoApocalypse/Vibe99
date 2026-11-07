//! Export the displayed document snapshot through a native, user-chosen path.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{io::Write, path::Path};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const MAX_DOCUMENT_BYTES: usize = 4 * 1024 * 1024;

fn suggested_name(path: &str) -> String {
    let leaf = path.rsplit(['/', '\\']).next().unwrap_or_default();
    let clean: String = leaf
        .chars()
        .take(120)
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let mut name = clean.trim().trim_end_matches('.').to_string();
    if name.is_empty() {
        return "document.md".into();
    }
    let base = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (base.len() == 4
            && (base.starts_with("COM") || base.starts_with("LPT"))
            && matches!(base.as_bytes()[3], b'1'..=b'9'))
    {
        name.insert(0, '_');
    }
    let extension = name_extension(leaf);
    if !name.to_ascii_lowercase().ends_with(&format!(".{}", extension.to_ascii_lowercase())) {
        name.push('.');
        name.push_str(extension);
    }
    name
}

#[cfg(test)]
fn write_snapshot(path: &Path, text: &str) -> Result<(), String> {
    if text.len() > MAX_DOCUMENT_BYTES {
        return Err("Markdown exceeds the 4 MiB preview limit".into());
    }
    write_bytes(path, text.as_bytes())
}

fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("The save location has no parent directory")?;
    // Stage beside the destination so a failed write cannot truncate an existing file.
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn preview_save_as(
    app: AppHandle,
    window: WebviewWindow,
    filename: String,
    text: Option<String>,
    data: Option<String>,
) -> Result<Option<String>, String> {
    let bytes = match (text, data) {
        (Some(text), None) if text.len() <= MAX_DOCUMENT_BYTES => text.into_bytes(),
        (None, Some(data)) if data.len() <= 22_369_624 => {
            let bytes = STANDARD.decode(data).map_err(|_| "Invalid file data")?;
            if bytes.len() > 16 * 1024 * 1024 {
                return Err("File exceeds the 16 MiB preview limit".into());
            }
            bytes
        }
        _ => return Err("Invalid or oversized document snapshot".into()),
    };
    let downloads = app
        .path()
        .download_dir()
        .map_err(|e| format!("Downloads folder unavailable: {e}"))?;
    let name = suggested_name(&filename);
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Save File As")
            .set_directory(downloads)
            .set_file_name(name)
            .add_filter("Original format", &[name_extension(&filename)])
            .add_filter("All files", &["*"])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        write_bytes(&path, &bytes)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn name_extension(filename: &str) -> &str {
    filename
        .rsplit('.')
        .next()
        .filter(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "md" | "markdown"
                    | "mdown"
                    | "pdf"
                    | "png"
                    | "jpg"
                    | "jpeg"
                    | "gif"
                    | "webp"
                    | "avif"
                    | "bmp"
            )
        })
        .unwrap_or("md")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn suggested_names_are_local_markdown_filenames() {
        assert_eq!(suggested_name("/tmp/report.pdf"), "report.pdf");
        assert_eq!(suggested_name("/tmp/photo.PNG"), "photo.PNG");
        assert!(suggested_name(&format!("{}.pdf", "x".repeat(200))).ends_with(".pdf"));
        assert_eq!(
            suggested_name("/remote/docs/方案.markdown"),
            "方案.markdown"
        );
        assert_eq!(suggested_name(r"C:\docs\notes.md"), "notes.md");
        assert_eq!(suggested_name("../CON.md"), "_CON.md");
        assert_eq!(suggested_name(""), "document.md");
        assert_eq!(suggested_name("bad:name?.md"), "bad_name_.md");
    }
    #[test]
    fn saves_exact_utf8_snapshot_and_replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.md");
        let text = "# 方案\r\n\r\n![图](figure.png)\n";
        write_snapshot(&path, text).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), text.as_bytes());
        write_snapshot(&path, "replacement\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "replacement\n");
        assert!(write_snapshot(&path, &"x".repeat(MAX_DOCUMENT_BYTES + 1)).is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "replacement\n");
    }
    #[test]
    fn saves_binary_without_reencoding() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("report.pdf");
        let bytes = b"%PDF-1.4\n\0\xff";
        write_bytes(&path, bytes).unwrap();
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
}
