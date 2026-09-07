param(
  [string]$OutputDirectory = '.cache/release'
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'A stable semantic version is required for release packaging.' }
$config = Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
if ($config.version -ne $version) { throw 'npm and Tauri release versions differ.' }
$releaseRoot = Join-Path $projectRoot 'src-tauri/target/release'
$binary = Join-Path $releaseRoot 'mind-board.exe'
$installer = Join-Path $releaseRoot "bundle/nsis/MindBoard_${version}_x64-setup.exe"
foreach ($file in @($binary, $installer)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing release artifact: $file" }
}
$binaryVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($binary).ProductVersion
if ($binaryVersion -notmatch ('^' + [regex]::Escape($version) + '(\.0)?$')) {
  throw "Executable version $binaryVersion does not match requested release $version. Rebuild first."
}
$output = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory))
if (-not $output.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Release output must remain inside this project.'
}
$output = Join-Path $output "v$version"
New-Item -ItemType Directory -Force -Path $output | Out-Null
$portable = Join-Path $output "MindBoard_${version}_windows-x64-portable.zip"
$staged = Join-Path $output 'portable'
New-Item -ItemType Directory -Force -Path $staged | Out-Null
Copy-Item -LiteralPath $binary -Destination (Join-Path $staged 'MindBoard.exe') -Force
foreach ($name in @('LICENSE', 'THIRD_PARTY_NOTICES.txt')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination (Join-Path $staged $name) -Force
}
@"
MindBoard $version - Windows x64

Run MindBoard.exe. This portable download does not require installation.
Microsoft Edge WebView2 Runtime is required; it is normally available on Windows.
If it is missing, install it from https://developer.microsoft.com/microsoft-edge/webview2/

Right-click the canvas for tools. Tab shows or hides optional controls.
Drop images to import them. N adds a sticky note; double-click a note to edit it.
Use Save board to keep a portable .mindboard file including your images.
Automatic recovery is stored in your Windows user profile, not beside the executable.

Source, documentation, and issues: https://github.com/A7E7-Studios/mind-board
MIT licensed; see LICENSE and THIRD_PARTY_NOTICES.txt.
"@ | Set-Content -LiteralPath (Join-Path $staged 'README.txt') -Encoding utf8
$portableFiles = @('MindBoard.exe', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'README.txt') | ForEach-Object { Join-Path $staged $_ }
Compress-Archive -LiteralPath $portableFiles -DestinationPath $portable -Force
$publishedInstaller = Join-Path $output (Split-Path -Leaf $installer)
Copy-Item -LiteralPath $installer -Destination $publishedInstaller -Force
$artifacts = @($publishedInstaller, $portable)
$checksums = foreach ($file in $artifacts) {
  $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
  "$($hash.Hash.ToLowerInvariant())  $(Split-Path -Leaf $file)"
}
$checksums | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ascii
$artifacts | ForEach-Object { Get-Item -LiteralPath $_ } | Select-Object Name, Length
Write-Output "Release downloads and SHA256SUMS.txt are ready in $output"
