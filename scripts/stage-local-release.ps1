param([string]$SourceExe)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
if (!$SourceExe) { $SourceExe = Join-Path $root 'src-tauri/target/release/vibe99.exe' }
$source = (Get-Item -LiteralPath $SourceExe).FullName
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$metadata = [Diagnostics.FileVersionInfo]::GetVersionInfo($source)
if ($metadata.ProductName -cne 'Vibe99' -or $metadata.ProductVersion -cne $version) {
    throw 'Expected the production Vibe99 executable matching package.json, not a review build.'
}
$release = Join-Path $root 'artifacts/release'
$destination = Join-Path $release 'Vibe99'
$target = Join-Path $destination 'Vibe99.exe'
if ([IO.Path]::GetFullPath($source) -eq [IO.Path]::GetFullPath($target)) { throw 'Source must differ from the stable executable' }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$stage = Join-Path $destination ('Vibe99-staged-' + [guid]::NewGuid() + '.exe')
$previous = Join-Path $destination ('Vibe99-previous-' + [guid]::NewGuid() + '.exe')
Copy-Item -LiteralPath $source -Destination $stage
$expected = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
if ((Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash -cne $expected) { throw 'Staged executable hash mismatch' }
foreach ($name in @('LICENSE', 'THIRD_PARTY_NOTICES.md')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $destination $name) -Force
}
# Rename the old image instead of overwriting a running executable. Existing
# processes retain their image; new launches use the new path. Never stop users' sessions.
if (Test-Path -LiteralPath $target) {
    try { Move-Item -LiteralPath $target -Destination $previous }
    catch { Remove-Item -LiteralPath $stage; throw 'Cannot refresh the stable executable. Close that Vibe99 window and retry; its files and sessions were not changed.' }
}
try { Move-Item -LiteralPath $stage -Destination $target }
catch {
    if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $target }
    throw
}
$shell = New-Object -ComObject WScript.Shell
$link = Join-Path $release 'Vibe99.lnk'
if (Test-Path -LiteralPath $link) {
    if ($shell.CreateShortcut($link).TargetPath -ine $target) { throw 'Refusing to replace an unrelated shortcut' }
}
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $env:USERPROFILE
$shortcut.IconLocation = "$target,0"
$shortcut.Description = 'Vibe99 - latest locally staged release'
$shortcut.Save()
$actual = $shell.CreateShortcut($link)
if ($actual.TargetPath -ine $target -or !(Test-Path -LiteralPath $actual.TargetPath)) { throw 'Shortcut verification failed' }
# Retain a running previous image if Windows still holds it. Only our own
# explicitly named backup files are eligible for cleanup; never recurse.
Get-ChildItem -LiteralPath $destination -Filter 'Vibe99-previous-*.exe' -File | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -ErrorAction SilentlyContinue
}
[ordered]@{ version=$version; executable=$target; shortcut=$link; sha256=$expected.ToLowerInvariant() } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $release 'current.json') -Encoding UTF8
Get-Content -LiteralPath (Join-Path $release 'current.json')
