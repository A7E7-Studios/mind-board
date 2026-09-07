param(
  [Parameter(Mandatory)][ValidateSet('Apply', 'Restore')][string]$Mode,
  [Parameter(Mandatory)][string]$StatePath,
  [string]$ProfilePath,
  [string]$RuntimePath,
  [string]$BrowserLogPath
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:DESKTOP_ELEVATED_POLICY -ne '1') {
  throw 'Elevated WebView2 debugging policy is restricted to an explicitly opted-in GitHub Actions runner.'
}
$policyRoot = 'Software\Policies\Microsoft\Edge\WebView2'
$valueNames = @('mind-board.exe', 'com.a7e7.mindboard')
$allowedKeys = @('AdditionalBrowserArguments', 'UserDataFolder', 'BrowserExecutableFolder')

if ($Mode -eq 'Apply') {
  if (Test-Path -LiteralPath $StatePath) { throw 'A policy backup already exists; refusing to overwrite it.' }
  if (-not $ProfilePath -or -not $RuntimePath -or -not $BrowserLogPath) { throw 'Explicit profile, runtime, and browser log paths are required.' }
  $settings = @{
    AdditionalBrowserArguments = '--remote-debugging-port=0 --enable-logging --log-file="' + $BrowserLogPath + '"'
    UserDataFolder = $ProfilePath
    BrowserExecutableFolder = $RuntimePath
  }
  $backup = @()
  foreach ($setting in $allowedKeys) {
    $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey("$policyRoot\$setting")
    try {
      foreach ($name in $valueNames) {
        $existed = $null -ne $key -and $key.GetValueNames() -contains $name
        $backup += [pscustomobject]@{
          Setting = $setting; Name = $name; Existed = $existed
          Value = $(if ($existed) { $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null })
          Kind = $(if ($existed) { $key.GetValueKind($name).ToString() } else { 'String' })
        }
      }
    } finally { if ($null -ne $key) { $key.Dispose() } }
  }
  # Persist the complete rollback record before changing any named value.
  $backup | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StatePath -Encoding utf8
  foreach ($setting in $allowedKeys) {
    $key = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey("$policyRoot\$setting")
    try { foreach ($name in $valueNames) { $key.SetValue($name, $settings[$setting], [Microsoft.Win32.RegistryValueKind]::String) } }
    finally { $key.Dispose() }
  }
  Write-Output 'Applied app-specific WebView2 debugging policy for the disposable CI run.'
} else {
  if (-not (Test-Path -LiteralPath $StatePath)) { throw 'Policy rollback record is missing.' }
  $backup = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  foreach ($entry in $backup) {
    if ($entry.Setting -notin $allowedKeys -or $entry.Name -notin $valueNames) { throw 'Unexpected policy rollback target.' }
    $key = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey("$policyRoot\$($entry.Setting)")
    try {
      if ($entry.Existed) {
        $kind = [Enum]::Parse([Microsoft.Win32.RegistryValueKind], [string]$entry.Kind)
        $value = switch ($entry.Kind) {
          'DWord' { [int]$entry.Value }
          'QWord' { [long]$entry.Value }
          'Binary' { ,([byte[]]$entry.Value) }
          'MultiString' { ,([string[]]$entry.Value) }
          default { [string]$entry.Value }
        }
        $key.SetValue($entry.Name, $value, $kind)
      } else { $key.DeleteValue($entry.Name, $false) }
    } finally { $key.Dispose() }
  }
  Write-Output 'Restored all prior app-specific WebView2 policy values.'
}
