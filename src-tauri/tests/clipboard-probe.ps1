# Independent Windows clipboard consumer. Original contents stay in memory and
# are restored best effort; no user's clipboard data is written to test logs.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class ClipboardSequence {
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
}
'@
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'Clipboard probe requires STA.' }
$saved = New-Object System.Windows.Forms.DataObject
$savedCount = 0
$failedCount = 0
$resources = @()
$original = [System.Windows.Forms.Clipboard]::GetDataObject()
$originalEmpty = $null -eq $original
if ($null -ne $original) {
  $originalFormats = @($original.GetFormats($false))
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
@{ ready = $true; savedFormats = $savedCount; failedFormats = $failedCount } | ConvertTo-Json -Compress | Write-Output
try {
  while ($null -ne ($command = [Console]::ReadLine())) {
    switch ($command) {
      'read' {
        $readSequence = [ClipboardSequence]::GetClipboardSequenceNumber()
        $bitmap = [System.Windows.Forms.Clipboard]::GetImage()
        if ($null -eq $bitmap) { @{ image = $false } | ConvertTo-Json -Compress | Write-Output; continue }
        try {
          $samples = @(0, 1, 2, 3, 4, 5, 6, 7) | ForEach-Object {
            $pixel = $bitmap.GetPixel($_, [Math]::Min(20, $bitmap.Height - 1))
            @($pixel.R, $pixel.G, $pixel.B, $pixel.A)
          }
          @{ image = $true; width = $bitmap.Width; height = $bitmap.Height; samples = @($samples) } | ConvertTo-Json -Compress -Depth 4 | Write-Output
        } finally { $bitmap.Dispose() }
      }
      'claim' {
        $ownedSequence = $readSequence
        @{ claimed = $true } | ConvertTo-Json -Compress | Write-Output
      }
      'restore' {
        $restored = $false
        if ($null -ne $ownedSequence -and [ClipboardSequence]::GetClipboardSequenceNumber() -eq $ownedSequence) {
          if ($originalEmpty) { [System.Windows.Forms.Clipboard]::Clear(); $restored = $true }
          elseif ($savedCount -gt 0) { [System.Windows.Forms.Clipboard]::SetDataObject($saved, $true, 10, 50); $restored = $true }
        }
        @{ restored = $restored; partialBackup = ($failedCount -gt 0) } | ConvertTo-Json -Compress | Write-Output
        return
      }
      default { throw 'Unknown clipboard probe command.' }
    }
  }
} finally {
  foreach ($resource in $resources) { $resource.Dispose() }
}
