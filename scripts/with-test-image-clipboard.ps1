param([Parameter(Mandatory)][string]$TestRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type 'using System.Runtime.InteropServices; public static class ClipSequence { [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber(); }'
$saved = New-Object System.Windows.Forms.DataObject
$original = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($original) {
  foreach ($format in $original.GetFormats($false)) {
    $value = $original.GetData($format, $false)
    if ($value -is [System.Drawing.Image]) { $value = $value.Clone() }
    if ($null -ne $value) { $saved.SetData($format, $false, $value) }
  }
}
$fixture = New-Object System.Drawing.Bitmap(32, 32)
$graphics = [System.Drawing.Graphics]::FromImage($fixture)
$graphics.Clear([System.Drawing.Color]::Crimson)
$graphics.Dispose()
$fixture.Save((Join-Path $TestRoot 'clipboard-fixture.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$ownsClipboard = $false
try {
  [System.Windows.Forms.Clipboard]::SetImage($fixture)
  $sequence = [ClipSequence]::GetClipboardSequenceNumber()
  $ownsClipboard = $true
  Set-Content -LiteralPath (Join-Path $TestRoot 'clipboard-ready') -Value 'ready'
  $deadline = [DateTime]::UtcNow.AddMinutes(12)
  while (!(Test-Path -LiteralPath (Join-Path $TestRoot 'clipboard-done')) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
} finally {
  # Never overwrite a newer clipboard entry copied by the user during the test.
  if ($ownsClipboard -and [ClipSequence]::GetClipboardSequenceNumber() -eq $sequence) {
    [System.Windows.Forms.Clipboard]::SetDataObject($saved, $true)
    Set-Content -LiteralPath (Join-Path $TestRoot 'clipboard-restored') -Value 'restored'
  } else {
    Set-Content -LiteralPath (Join-Path $TestRoot 'clipboard-restored') -Value 'newer clipboard preserved'
  }
  $fixture.Dispose()
}
