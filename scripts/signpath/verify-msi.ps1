param(
    [Parameter(Mandatory)][string]$MsiPath,
    [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [string]$ExpectedSignerSubject,
    [string]$DarkPath = "$env:LOCALAPPDATA/tauri/WixTools314/dark.exe",
    [switch]$InspectUnsigned
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Signature([string]$FilePath) {
    $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
    if ($signature.Status -ne 'Valid') {
        throw "Invalid Authenticode signature on ${FilePath}: $($signature.Status)"
    }
    if (!$signature.TimeStamperCertificate) {
        throw "Missing Authenticode timestamp on $FilePath"
    }
    if ($signature.SignerCertificate.Subject -cne $ExpectedSignerSubject) {
        throw "Unexpected publisher on $FilePath"
    }
}

$msi = Get-Item -LiteralPath $MsiPath
if ($msi.Name -cne "Vibe99_${Version}_x64_en-US.msi") {
    throw 'Unexpected MSI filename or release version'
}
if (!$InspectUnsigned) {
    if ([string]::IsNullOrWhiteSpace($ExpectedSignerSubject)) {
        throw 'ExpectedSignerSubject is required for production verification'
    }
    Assert-Signature $msi.FullName
}
if (!(Test-Path -LiteralPath $DarkPath -PathType Leaf)) {
    throw "WiX dark.exe not found at $DarkPath (build the MSI with Tauri first)"
}

# Decompile and extract only; do not install or execute the MSI or application.
$scratchRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$scratch = Join-Path $scratchRoot ('vibe99-msi-check-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $scratch | Out-Null
$wxsPath = Join-Path $scratch 'package.wxs'
& $DarkPath -nologo -sw1059 -x $scratch $msi.FullName $wxsPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw "WiX extraction failed: $LASTEXITCODE" }

[xml]$wxs = Get-Content -LiteralPath $wxsPath -Raw
$ns = New-Object Xml.XmlNamespaceManager($wxs.NameTable)
$ns.AddNamespace('w', 'http://schemas.microsoft.com/wix/2006/wi')
$product = $wxs.SelectSingleNode('/w:Wix/w:Product', $ns)
if (!$product -or $product.Name -cne 'Vibe99' -or $product.Version -cne $Version) {
    throw 'MSI product metadata does not match the release'
}
$files = @($wxs.SelectNodes('//w:File', $ns))
$applications = @($files | Where-Object { $_.Name -ceq 'vibe99.exe' })
if ($applications.Count -ne 1) { throw 'Expected exactly one vibe99.exe in the MSI' }
# dark uses the MSI File table identifier as the extracted filename.
$application = Join-Path (Join-Path $scratch 'File') $applications[0].Id
$metadata = [Diagnostics.FileVersionInfo]::GetVersionInfo($application)
if ($metadata.ProductName -cne 'Vibe99' -or $metadata.ProductVersion -cne $Version) {
    throw 'Installed application product metadata does not match the release'
}
if (!$InspectUnsigned) { Assert-Signature $application }

[ordered]@{
    msi = $msi.Name
    sha256 = (Get-FileHash -LiteralPath $msi.FullName -Algorithm SHA256).Hash
    version = $Version
    application = $applications[0].Name
    applicationSha256 = (Get-FileHash -LiteralPath $application -Algorithm SHA256).Hash
    signed = !$InspectUnsigned.IsPresent
    publisher = if ($InspectUnsigned) { $null } else { $ExpectedSignerSubject }
} | ConvertTo-Json
