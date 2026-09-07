# Independent Windows clipboard consumer. Original contents stay in memory and
# are restored best effort; no user's clipboard data is written to test logs.
$ErrorActionPreference = 'Stop'
function Write-Stage([string]$Name) {
  [Console]::Error.WriteLine("clipboard-probe:$Name")
  [Console]::Error.Flush()
}
function Write-Reply($Value) {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $Value -Compress -Depth 4))
  [Console]::Out.Flush()
}
Write-Stage 'script-start'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Write-Stage 'assemblies-loaded'
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class ClipboardSequence {
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
}
'@
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'Clipboard probe requires STA.' }
Write-Stage 'interop-ready-sta'
$saved = New-Object System.Windows.Forms.DataObject
$savedCount = 0
$failedCount = 0
$resources = @()
$original = [System.Windows.Forms.Clipboard]::GetDataObject()
Write-Stage 'clipboard-acquired'
$originalEmpty = $null -eq $original
if ($null -ne $original) {
  $originalFormats = @($original.GetFormats($false))
  Write-Stage "backup-formats-$($originalFormats.Count)"
  $originalEmpty = $originalFormats.Count -eq 0
  foreach ($format in $originalFormats) {
    try {
      $value = $original.GetData($format, $false)
      if ($value -is [System.IO.MemoryStream]) {
        $value = [System.IO.MemoryStream]::new($value.ToArray())
        $resources += $value
      } elseif ($value -is [System.Drawing.Image]) {
        $value = $value.Clone()
        $resources += $value
      }
      if ($null -ne $value) { $saved.SetData($format, $false, $value); $savedCount++ }
      else { $failedCount++ }
    } catch { $failedCount++ }
  }
}
$ownedSequence = $null
$readSequence = $null
Write-Stage 'backup-complete'
Write-Reply @{ ready = $true; savedFormats = $savedCount; failedFormats = $failedCount }
try {
  while ($null -ne ($command = [Console]::ReadLine())) {
    switch ($command) {
      'read-text' {
        $readSequence = [ClipboardSequence]::GetClipboardSequenceNumber()
        Write-Reply @{ text = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText) }
      }
      'read' {
        $readSequence = [ClipboardSequence]::GetClipboardSequenceNumber()
        $bitmap = [System.Windows.Forms.Clipboard]::GetImage()
        if ($null -eq $bitmap) { Write-Reply @{ image = $false }; continue }
        try {
          $samples = @(0, 1, 2, 3, 4, 5, 6, 7) | ForEach-Object {
            $pixel = $bitmap.GetPixel($_, [Math]::Min(20, $bitmap.Height - 1))
            @($pixel.R, $pixel.G, $pixel.B, $pixel.A)
          }
          Write-Reply @{ image = $true; width = $bitmap.Width; height = $bitmap.Height; samples = @($samples) }
        } finally { $bitmap.Dispose() }
      }
      'claim' {
        $ownedSequence = $readSequence
        Write-Reply @{ claimed = $true }
      }
      'restore' {
        $restored = $false
        if ($null -ne $ownedSequence -and [ClipboardSequence]::GetClipboardSequenceNumber() -eq $ownedSequence) {
          if ($originalEmpty) { [System.Windows.Forms.Clipboard]::Clear(); $restored = $true }
          elseif ($savedCount -gt 0) { [System.Windows.Forms.Clipboard]::SetDataObject($saved, $true, 10, 50); $restored = $true }
        }
        Write-Reply @{ restored = $restored; partialBackup = ($failedCount -gt 0) }
        return
      }
      default { throw 'Unknown clipboard probe command.' }
    }
  }
} finally {
  foreach ($resource in $resources) { $resource.Dispose() }
}
