//! Read only the processes owned by a terminal; never run a shell or inspect arguments.
use std::{mem::{size_of, MaybeUninit}, path::PathBuf};

pub fn cwd(pid: u32) -> Option<PathBuf> {
    let mut info = MaybeUninit::<libc::proc_vnodepathinfo>::zeroed();
    // SAFETY: libproc writes at most the supplied size into an aligned native struct.
    let count = unsafe { libc::proc_pidinfo(pid.try_into().ok()?, libc::PROC_PIDVNODEPATHINFO,
        0, info.as_mut_ptr().cast(), size_of::<libc::proc_vnodepathinfo>() as i32) };
    if count as usize != size_of::<libc::proc_vnodepathinfo>() { return None; }
    let info = unsafe { info.assume_init() };
    let bytes: Vec<u8> = info.pvi_cdir.vip_path.iter().flatten()
        .map(|c| *c as u8).take_while(|c| *c != 0).collect();
    use std::os::unix::ffi::OsStringExt;
    let path = PathBuf::from(std::ffi::OsString::from_vec(bytes));
    path.is_absolute().then_some(path)
}

fn name(pid: u32) -> Option<String> {
    let mut bytes = [0u8; 1024];
    let count = unsafe { libc::proc_name(pid.try_into().ok()?, bytes.as_mut_ptr().cast(), bytes.len() as u32) };
    if count <= 0 { return None; }
    Some(String::from_utf8_lossy(&bytes[..count as usize]).trim_end_matches('\0').to_lowercase())
}

fn is_remote(name: &str) -> bool {
    matches!(name, "ssh" | "mosh" | "mosh-client" | "docker" | "podman" | "kubectl" | "tmux" | "screen")
}

/// Deliberately does not infer SSH destinations. Detached multiplexers and remote
/// clients need explicit mapping until their filesystem context can be verified.
pub fn is_local(root: u32) -> bool {
    let mut pending = vec![root];
    let mut visited = std::collections::HashSet::new();
    while let Some(pid) = pending.pop() {
        if !visited.insert(pid) { continue; }
        if visited.len() > 256 { return false; }
        let Some(name) = name(pid) else { return false; };
        if is_remote(&name) { return false; }
        let mut children = [0i32; 257];
        let count = unsafe { libc::proc_listchildpids(pid as i32, children.as_mut_ptr().cast(),
            size_of::<[i32; 257]>() as i32) };
        if count < 0 || children.last().copied().unwrap_or_default() != 0 { return false; }
        pending.extend(children.into_iter().filter(|p| *p > 0).map(|p| p as u32));
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_real_child_cwd_with_spaces_without_shell_integration() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("space 中文");
        std::fs::create_dir(&path).unwrap();
        let mut child = std::process::Command::new("/bin/sleep").arg("30").current_dir(&path).spawn().unwrap();
        let actual = cwd(child.id());
        let local = is_local(child.id());
        child.kill().unwrap(); child.wait().unwrap();
        assert_eq!(actual.unwrap(), path.canonicalize().unwrap());
        assert!(local);
        assert!(cwd(child.id()).is_none());
    }
    #[test]
    fn refuses_remote_and_detached_process_contexts() {
        for name in ["ssh", "mosh-client", "docker", "kubectl", "tmux", "screen"] { assert!(is_remote(name)); }
        assert!(!is_remote("zsh"));
        assert!(!is_local(u32::MAX));
    }
}
