//! Read-only previews and an owned, ephemeral SSH bridge per workspace.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Emitter, State};
const BRIDGE: &str = include_str!("../../remote/vibe99_bridge.py");
const MAX_LINE: u64 = 32 * 1024 * 1024;
type Reply = Result<Value, String>;
#[derive(Default)]
pub struct WorkspaceManager {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}
enum Session {
    Opening(Arc<Opening>),
    Local(PathBuf),
    Remote(Arc<Remote>),
}
#[derive(Default)]
struct Opening {
    closed: AtomicBool,
    remote: Mutex<Option<Arc<Remote>>>,
}
impl Session {
    fn close(&self) {
        match self {
            Session::Remote(remote) => remote.close(),
            Session::Opening(opening) => {
                opening.closed.store(true, Ordering::SeqCst);
                if let Some(remote) = opening.remote.lock().unwrap().as_ref() {
                    remote.close();
                }
            }
            Session::Local(_) => {}
        }
    }
}
struct Remote {
    child: Mutex<Child>,
    sender: mpsc::SyncSender<String>,
    pending: Mutex<HashMap<u64, mpsc::SyncSender<Reply>>>,
    next: AtomicU64,
    closed: AtomicBool,
}
impl Remote {
    fn send(&self, value: Value) -> Result<(), String> {
        if self.closed.load(Ordering::SeqCst) {
            return Err("SSH workspace disconnected".into());
        }
        let line = serde_json::to_string(&value).map_err(|e| e.to_string())?;
        if line.len() > 128 * 1024 {
            return Err("Request exceeds 128 KiB".into());
        }
        self.sender
            .try_send(line)
            .map_err(|_| "SSH request queue full or disconnected".into())
    }
    fn request(&self, method: &str, args: Value, timeout: Duration) -> Reply {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::sync_channel(1);
        {
            let mut pending = self.pending.lock().unwrap();
            if pending.len() >= 32 {
                return Err("Too many pending workspace requests".into());
            }
            pending.insert(id, tx);
        }
        if let Err(error) = self.send(json!({"id":id,"method":method,"args":args})) {
            self.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        let result = rx
            .recv_timeout(timeout)
            .unwrap_or_else(|_| Err("Workspace request timed out".into()));
        self.pending.lock().unwrap().remove(&id);
        result
    }
    fn close(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = self.sender.try_send("{\"method\":\"close\"}".into());
        for (_, sender) in self.pending.lock().unwrap().drain() {
            let _ = sender.try_send(Err("SSH workspace disconnected".into()));
        }
        let mut child = self.child.lock().unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}
impl WorkspaceManager {
    pub fn close_all(&self) {
        let sessions: Vec<_> = self
            .sessions
            .lock()
            .unwrap()
            .drain()
            .map(|(_, s)| s)
            .collect();
        let workers: Vec<_> = sessions
            .into_iter()
            .map(|session| {
                thread::spawn(move || {
                    session.close();
                })
            })
            .collect();
        for worker in workers {
            let _ = worker.join();
        }
    }
}
impl Drop for WorkspaceManager {
    fn drop(&mut self) {
        self.close_all();
    }
}
fn ssh_open(
    app: AppHandle,
    workspace_id: String,
    target: String,
    root: String,
    opening: Arc<Opening>,
) -> Result<(Arc<Session>, Value), String> {
    if target.is_empty()
        || target.starts_with('-')
        || target.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("Use an SSH config host or user@host".into());
    }
    let code = STANDARD.encode(BRIDGE);
    let remote_command=format!("python3 -u -c 'import base64;exec(compile(base64.b64decode(\"{code}\"),\"vibe99_bridge.py\",\"exec\"))'");
    // Windows CreateProcess has a 32,767 UTF-16 unit command-line limit.
    if remote_command.encode_utf16().count() + target.encode_utf16().count() > 30_000 {
        return Err("Embedded SSH bridge exceeds Windows command-line limit".into());
    }
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
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=2",
            "--",
            &target,
            &remote_command,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Cannot start SSH: {e}"))?;
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let (tx, rx) = mpsc::sync_channel::<String>(64);
    let remote = Arc::new(Remote {
        child: Mutex::new(child),
        sender: tx,
        pending: Mutex::new(HashMap::new()),
        next: AtomicU64::new(1),
        closed: AtomicBool::new(false),
    });
    {
        let mut owned = opening.remote.lock().unwrap();
        *owned = Some(remote.clone());
        if opening.closed.load(Ordering::SeqCst) {
            remote.close();
            return Err("Workspace closed during connection".into());
        }
    }
    let weak = Arc::downgrade(&remote);
    thread::spawn(move || {
        loop {
            match rx.recv_timeout(Duration::from_secs(2)) {
                Ok(line) => {
                    if writeln!(stdin, "{line}")
                        .and_then(|_| stdin.flush())
                        .is_err()
                    {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if weak
                        .upgrade()
                        .map(|r| r.closed.load(Ordering::SeqCst))
                        .unwrap_or(true)
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        if let Some(remote) = weak.upgrade() {
            remote.close();
        }
    });
    let errors = Arc::new(Mutex::new(String::new()));
    let error_copy = errors.clone();
    thread::spawn(move || {
        let mut reader = stderr;
        let mut buf = [0; 2048];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            let mut text = error_copy.lock().unwrap();
            if text.len() < 8192 {
                text.push_str(&String::from_utf8_lossy(&buf[..n]));
            }
        }
    });
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let reader_remote = remote.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.by_ref().take(MAX_LINE + 1).read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) if line.len() as u64 > MAX_LINE => break,
                _ => {}
            }
            let Ok(mut value) = serde_json::from_str::<Value>(&line) else {
                break;
            };
            if value["event"] == "ready" {
                let _ = ready_tx.try_send(());
            } else if let Some(id) = value["id"].as_u64() {
                if let Some(sender) = reader_remote.pending.lock().unwrap().remove(&id) {
                    let result = if let Some(error) = value["error"].as_str() {
                        Err(error.into())
                    } else {
                        Ok(value["result"].take())
                    };
                    let _ = sender.try_send(result);
                }
            } else if value["event"].is_string() {
                value["workspaceId"] = json!(workspace_id);
                let _ = app.emit("vibe99:workspace-event", value);
            }
        }
        reader_remote.close();
        let _ = app.emit(
            "vibe99:workspace-event",
            json!({"workspaceId":workspace_id,"event":"disconnected"}),
        );
    });
    if ready_rx.recv_timeout(Duration::from_secs(25)).is_err() {
        remote.close();
        return Err(format!(
            "SSH bridge did not start: {}",
            errors.lock().unwrap()
        ));
    }
    let info = match remote.request("hello", json!({"root":root}), Duration::from_secs(30)) {
        Ok(value) => value,
        Err(error) => {
            remote.close();
            return Err(error);
        }
    };
    let weak = Arc::downgrade(&remote);
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(15));
        let Some(remote) = weak.upgrade() else { break };
        if remote.closed.load(Ordering::SeqCst) {
            break;
        }
        if remote.send(json!({"method":"ping"})).is_err() {
            remote.close();
            break;
        }
    });
    Ok((Arc::new(Session::Remote(remote)), info))
}
fn local_path(root: &Path, input: &str) -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    let path = if input == "~" {
        PathBuf::from(home)
    } else if input.starts_with("~/") || input.starts_with("~\\") {
        PathBuf::from(home).join(&input[2..])
    } else {
        PathBuf::from(input)
    };
    let canonical = fs::canonicalize(if path.is_absolute() {
        path
    } else {
        root.join(path)
    })
    .map_err(|e| e.to_string())?;
    Ok(display_path(canonical))
}
fn display_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(tail) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{tail}"));
        }
        if let Some(tail) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(tail);
        }
    }
    path
}
fn stat_local(path: &Path) -> Reply {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = meta
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    Ok(
        json!({"path":path,"directory":meta.is_dir(),"size":meta.len(),"stamp":format!("{modified}:{}",meta.len())}),
    )
}
fn local_request(root: &Path, method: &str, args: Value) -> Reply {
    let input = args["path"].as_str().unwrap_or("");
    if method == "image" {
        let source = args["source"].as_str().unwrap_or(input);
        if source.contains("://") || source.starts_with("data:") || source.starts_with("//") {
            return Err("External image URLs are not loaded".into());
        }
        let source = decode_image_source(source)?;
        let document = local_path(root, args["document"].as_str().unwrap_or(""))?;
        let mut base = document.parent().unwrap_or(root).to_path_buf();
        let mut candidate = base.join(&source);
        while !candidate.is_file()
            && base.starts_with(root)
            && base != root
            && !source.starts_with('.')
            && !Path::new(&source).is_absolute()
        {
            if !base.pop() {
                break;
            }
            candidate = base.join(&source);
        }
        let path = local_path(root, candidate.to_str().ok_or("Invalid image path")?)?;
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        let mime = match extension.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "avif" => "image/avif",
            "bmp" => "image/bmp",
            _ => return Err("Unsupported image format".into()),
        };
        let bytes = read_bounded(&path, 16 * 1024 * 1024)?;
        return Ok(
            json!({"path":path,"url":format!("data:{mime};base64,{}",STANDARD.encode(bytes))}),
        );
    }
    let path = local_path(root, input)?;
    match method {
        "stat" => stat_local(&path),
        "read" => {
            let before = stat_local(&path)?;
            let bytes = read_bounded(&path, 4 * 1024 * 1024)?;
            if bytes.contains(&0) {
                return Err("Binary files cannot be previewed".into());
            }
            let text = String::from_utf8(bytes).map_err(|_| "File is not UTF-8".to_string())?;
            if stat_local(&path)?["stamp"] != before["stamp"] {
                return Err("File changed while reading; retry".into());
            }
            Ok(
                json!({"path":path,"text":text.trim_start_matches('\u{feff}'),"stamp":before["stamp"]}),
            )
        }
        "list" => {
            let offset = args["offset"].as_u64().unwrap_or(0) as usize;
            let mut entries = Vec::new();
            for item in fs::read_dir(&path)
                .map_err(|e| e.to_string())?
                .skip(offset)
                .flatten()
                .take(101)
            {
                if let Ok(meta) = item.metadata() {
                    entries.push(json!({"name":item.file_name().to_string_lossy(),"path":item.path(),"directory":meta.is_dir(),"size":meta.len()}));
                }
            }
            let more = entries.len() > 100;
            entries.truncate(100);
            entries.sort_by_key(|v| {
                (
                    !v["directory"].as_bool().unwrap_or(false),
                    v["name"].as_str().unwrap_or("").to_lowercase(),
                )
            });
            Ok(json!({"path":path,"entries":entries,"next":if more{Some(offset+100)}else{None}}))
        }
        _ => Err("Unsupported local workspace method".into()),
    }
}
fn decode_image_source(source: &str) -> Result<String, String> {
    let source = source.split(['?', '#']).next().unwrap_or("");
    let mut out = Vec::new();
    let bytes = source.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err("Invalid image URL escape".into());
            }
            let value = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3])
                    .map_err(|_| "Invalid image URL escape")?,
                16,
            )
            .map_err(|_| "Invalid image URL escape")?;
            out.push(value);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "Invalid image path".into())
}
fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Choose a regular file".into());
    }
    let mut data = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() as u64 > limit {
        return Err("File exceeds preview size limit".into());
    }
    Ok(data)
}
#[tauri::command]
pub async fn workspace_open(
    app: AppHandle,
    state: State<'_, WorkspaceManager>,
    workspace_id: String,
    target: Option<String>,
    root: String,
) -> Reply {
    let opening = Arc::new(Opening::default());
    let reservation = Arc::new(Session::Opening(opening.clone()));
    {
        let mut sessions = state.sessions.lock().unwrap();
        if sessions.contains_key(&workspace_id) {
            return Err("Workspace already exists".into());
        }
        if sessions.len() >= 16 {
            return Err("Workspace limit reached".into());
        }
        sessions.insert(workspace_id.clone(), reservation.clone());
    }
    let id = workspace_id.clone();
    let result=tauri::async_runtime::spawn_blocking(move ||{if let Some(target)=target.filter(|s|!s.is_empty()){ssh_open(app,id,target,root,opening)}else{let root=local_path(&std::env::current_dir().map_err(|e|e.to_string())?,&root)?;if !root.is_dir(){return Err("Workspace root must be a directory".into());}let info=json!({"root":root,"home":std::env::var("USERPROFILE").unwrap_or_default(),"kind":"local"});Ok((Arc::new(Session::Local(root)),info))}}).await.map_err(|e|e.to_string())?;
    let mut sessions = state.sessions.lock().unwrap();
    match result {
        Ok((session, info)) => {
            if !sessions
                .get(&workspace_id)
                .is_some_and(|current| Arc::ptr_eq(current, &reservation))
            {
                drop(sessions);
                if let Session::Remote(remote) = session.as_ref() {
                    remote.close();
                }
                return Err("Workspace closed during connection".into());
            }
            sessions.insert(workspace_id, session);
            Ok(info)
        }
        Err(error) => {
            if sessions
                .get(&workspace_id)
                .is_some_and(|current| Arc::ptr_eq(current, &reservation))
            {
                sessions.remove(&workspace_id);
            }
            Err(error)
        }
    }
}
#[tauri::command]
pub async fn workspace_request(
    state: State<'_, WorkspaceManager>,
    workspace_id: String,
    method: String,
    args: Value,
) -> Reply {
    if !matches!(
        method.as_str(),
        "stat"
            | "read"
            | "image"
            | "list"
            | "terminal-start"
            | "terminal-input"
            | "terminal-resize"
            | "terminal-close"
            | "terminal-ack"
    ) {
        return Err("Unsupported workspace method".into());
    }
    let session = state
        .sessions
        .lock()
        .unwrap()
        .get(&workspace_id)
        .cloned()
        .ok_or("Workspace not found")?;
    tauri::async_runtime::spawn_blocking(move || match session.as_ref() {
        Session::Opening(_) => Err("Workspace is connecting".into()),
        Session::Local(root) => local_request(root, &method, args),
        Session::Remote(remote) => remote.request(&method, args, Duration::from_secs(30)),
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn workspace_close(
    state: State<'_, WorkspaceManager>,
    workspace_id: String,
) -> Result<(), String> {
    let session = state.sessions.lock().unwrap().remove(&workspace_id);
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(session) = session {
            session.close();
        }
    })
    .await
    .map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_preview_is_bounded_and_readonly() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("note.md"), "hello").unwrap();
        let result = local_request(dir.path(), "read", json!({"path":"note.md"})).unwrap();
        assert_eq!(result["text"], "hello");
        assert!(local_request(
            dir.path(),
            "save",
            json!({"path":"note.md","text":"changed"})
        )
        .is_err());
        fs::write(dir.path().join("binary"), [0, 1]).unwrap();
        assert!(local_request(dir.path(), "read", json!({"path":"binary"})).is_err());
    }
    #[test]
    fn image_urls_decode() {
        assert_eq!(
            decode_image_source("my%20image.png?x=1").unwrap(),
            "my image.png"
        );
        assert!(decode_image_source("bad%ZZ").is_err());
        assert!(decode_image_source("%中").is_err());
        #[cfg(windows)]
        assert_eq!(
            display_path(PathBuf::from(r"\\?\C:\work\a.md")),
            PathBuf::from(r"C:\work\a.md")
        );
    }
}
