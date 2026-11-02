use base64::Engine;
use std::path::Path;

// Profiles load normally before this startup command. No profile files are edited.
// Invoke the existing prompt first so it sees the previous command's status.
const POWERSHELL_INIT: &str = r#"
if (Test-Path Function:\prompt) {
    $vibe99OriginalPrompt = $function:prompt
    $vibe99PromptToken = $env:VIBE99_PROMPT_TOKEN
    Remove-Item Env:\VIBE99_PROMPT_TOKEN -ErrorAction SilentlyContinue
    $function:global:prompt = {
        $vibe99Prompt = & $vibe99OriginalPrompt
        [Console]::Write(([char]27).ToString() + '[?9;1000;1002;1003;1004;1006;1016l')
        if ($vibe99PromptToken -match '^[a-zA-Z0-9-]{1,128}$') {
            [Console]::Write(([char]27).ToString() + ']633;Vibe99Prompt;' + $vibe99PromptToken + [char]7)
            if ($PWD.Provider.Name -eq 'FileSystem') {
                [Console]::Write(([char]27).ToString() + ']7;' + ([Uri]$PWD.Path).AbsoluteUri + [char]7)
            }
        }
        $vibe99Prompt
    }.GetNewClosure()
}
"#;

pub fn args(shell: &Path, original: &[String]) -> Vec<String> {
    let name = shell
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    if !matches!(name.as_str(), "powershell" | "pwsh") {
        return original.to_vec();
    }
    // Do not reinterpret command/script profiles or custom arguments. Only the
    // ordinary interactive launch forms can safely accept our startup command.
    if original.iter().any(|arg| {
        !matches!(
            arg.to_lowercase().as_str(),
            "-nologo" | "-noprofile" | "-noexit" | "-login" | "-l"
        )
    }) {
        return original.to_vec();
    }
    let mut result = original.to_vec();
    if !result.iter().any(|arg| arg.eq_ignore_ascii_case("-noexit")) {
        result.push("-NoExit".into());
    }
    let bytes: Vec<u8> = POWERSHELL_INIT
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    result.push("-EncodedCommand".into());
    result.push(base64::engine::general_purpose::STANDARD.encode(bytes));
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wraps_only_interactive_powershell_and_preserves_flags() {
        let shell = Path::new("pwsh.exe");
        let flags = vec!["-NoLogo".into(), "-NoProfile".into()];
        let wrapped = args(shell, &flags);
        assert_eq!(&wrapped[..2], &flags);
        assert!(wrapped.contains(&"-NoExit".into()));
        assert!(wrapped.contains(&"-EncodedCommand".into()));
        for original in [
            vec!["-Command".into(), "echo hi".into()],
            vec!["-File".into(), "a.ps1".into()],
        ] {
            assert_eq!(args(shell, &original), original);
        }
        assert_eq!(args(Path::new("bash"), &flags), flags);
    }
}
