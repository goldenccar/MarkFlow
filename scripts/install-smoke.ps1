param(
  [string]$Installer,
  [switch]$InspectOnly
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$package = Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json
if ($package.build.appId -ne 'app.oopsmd.desktop' -or $package.build.productName -ne 'OopsMD') { throw 'The installer smoke test is scoped to OopsMD only.' }
if ($package.build.nsis.perMachine -or $package.build.nsis.deleteAppDataOnUninstall) { throw 'This test requires a per-user installer that preserves app data.' }
$guid = 'abb5ebd8-85e1-5fc5-a0c3-2e980a9ad384'
$testRoot = Join-Path $workspace '.test-data'
$logFile = Join-Path $testRoot 'install-validation.log'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$shortcutPaths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'OopsMD.lnk'),
  (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'OopsMD.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'OopsMD.lnk'),
  (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'OopsMD.lnk')
)
$registryInstallPaths = @("HKCU:\Software\$guid", "HKLM:\Software\$guid", "HKCU:\Software\WOW6432Node\$guid", "HKLM:\Software\WOW6432Node\$guid")
$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)

function Get-OopsRegistry {
  foreach ($registryPath in $registryInstallPaths) {
    if (Test-Path -LiteralPath $registryPath) {
      $entry = Get-ItemProperty -LiteralPath $registryPath
      [pscustomobject]@{ Path = $registryPath; Name = 'OopsMD install registration'; Location = $entry.InstallLocation }
    }
  }
  foreach ($registryRoot in $uninstallRoots) {
    if (-not (Test-Path -LiteralPath $registryRoot)) { continue }
    foreach ($key in Get-ChildItem -LiteralPath $registryRoot) {
      $entry = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
      if ($key.PSChildName -eq $guid -or $entry.DisplayName -like 'OopsMD*') {
        [pscustomobject]@{ Path = $key.PSPath; Name = $entry.DisplayName; Location = $entry.InstallLocation }
      }
    }
  }
}

function Get-PreexistingState {
  $paths = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\OopsMD'),
    (Join-Path $env:ProgramFiles 'OopsMD'),
    (Join-Path ${env:ProgramFiles(x86)} 'OopsMD'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'OopsMD'),
    (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'OopsMD')
  ) + $shortcutPaths
  [pscustomobject]@{
    Registry = @(Get-OopsRegistry)
    ExistingPaths = @($paths | Where-Object { Test-Path -LiteralPath $_ })
    Processes = @(Get-Process -Name OopsMD -ErrorAction SilentlyContinue | Select-Object Id, Path)
  }
}

function Assert-ContainedDirectory([string]$directory) {
  $resolved = [IO.Path]::GetFullPath($directory)
  if ([IO.Path]::GetDirectoryName($resolved) -ne [IO.Path]::GetFullPath($testRoot) -or -not [IO.Path]::GetFileName($resolved).StartsWith('installed-')) { throw "Unsafe test installation path: $resolved" }
  if (Test-Path -LiteralPath $resolved) {
    $item = Get-Item -LiteralPath $resolved
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Test installation path must be a real directory.' }
  }
  return $resolved
}

function Write-Log([string]$message) {
  $line = "$(Get-Date -AsUTC -Format o) $message"
  Write-Host $line
  Add-Content -LiteralPath $logFile -Value $line -Encoding utf8
}

function Wait-TestProcess($process, [int]$timeoutSeconds, [string]$name) {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  while (-not $process.WaitForExit(1000)) {
    if ($watch.Elapsed.TotalSeconds -gt $timeoutSeconds) { throw "$name exceeded $timeoutSeconds seconds; inspect process $($process.Id)." }
  }
  $process.Refresh()
  if ($process.ExitCode -ne 0) { throw "$name exited with code $($process.ExitCode)." }
}

function Invoke-NodeCheck([string[]]$arguments, [string]$label) {
  $stdout = Join-Path $testRoot "install-$label.stdout.log"
  $stderr = Join-Path $testRoot "install-$label.stderr.log"
  $quoted = ($arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
  Write-Log "RUN node $quoted"
  $process = Start-Process -FilePath $node -ArgumentList $quoted -WorkingDirectory $workspace -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  try { Wait-TestProcess $process 240 $label }
  finally {
    foreach ($output in @($stdout, $stderr)) {
      if (Test-Path -LiteralPath $output) {
        $content = Get-Content -LiteralPath $output -Raw
        if ($content) { Write-Host $content; Add-Content -LiteralPath $logFile -Value $content -Encoding utf8 }
      }
    }
  }
  Write-Log "PASS $label"
}

$before = Get-PreexistingState
if ($InspectOnly) { $before | ConvertTo-Json -Depth 6; return }
if ($before.Registry.Count -or $before.ExistingPaths.Count -or $before.Processes.Count) {
  $before | ConvertTo-Json -Depth 6
  throw 'An existing OopsMD installation, shortcut or process was found. Installation test skipped; nothing was changed.'
}
if (Test-Path -LiteralPath $testRoot) {
  if ((Get-Item -LiteralPath $testRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '.test-data must not be a link or junction.' }
} else { New-Item -ItemType Directory -Path $testRoot | Out-Null }
if (-not $Installer) { $Installer = Join-Path $workspace "release\OopsMD-$($package.version)-win-x64-setup.exe" }
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
if ([IO.Path]::GetDirectoryName($installerPath) -ne (Join-Path $workspace 'release')) { throw 'Only an installer in this workspace release directory can be tested.' }
$installDirectory = Assert-ContainedDirectory (Join-Path $testRoot ("installed-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)))
if (Test-Path -LiteralPath $installDirectory) { throw 'The test install directory already exists.' }
$previousSmokeExe = $env:OOPSMD_SMOKE_EXE
$installed = $false
$failure = $null
$appDataPaths = @((Join-Path $env:APPDATA 'OopsMD'), (Join-Path $env:LOCALAPPDATA 'OopsMD'))
$appDataBefore = @($appDataPaths | Where-Object { Test-Path -LiteralPath $_ })

try {
  Write-Log "BEGIN installer SHA256=$((Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash) destination=$installDirectory"
  Write-Log "Installer bytes=$((Get-Item -LiteralPath $installerPath).Length) Authenticode=$((Get-AuthenticodeSignature -LiteralPath $installerPath).Status)"
  Write-Log 'Preflight found no previous OopsMD registration, shortcuts, default installation or process.'
  $arguments = "/S /currentuser --no-desktop-shortcut /D=$installDirectory"
  Write-Log "RUN hidden installer $arguments"
  $process = Start-Process -FilePath $installerPath -ArgumentList $arguments -WorkingDirectory $workspace -WindowStyle Hidden -PassThru
  $installed = $true
  Wait-TestProcess $process 180 'NSIS install'
  $installedExe = Join-Path $installDirectory 'OopsMD.exe'
  $installedAsar = Join-Path $installDirectory 'resources\app.asar'
  $uninstaller = Join-Path $installDirectory 'Uninstall OopsMD.exe'
  foreach ($required in @($installedExe, $installedAsar, $uninstaller, (Join-Path $installDirectory 'resources\git\cmd\git.exe'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Installed file missing: $required" }
  }
  if ((Get-FileHash -LiteralPath $installedAsar -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath (Join-Path $workspace 'release\win-unpacked\resources\app.asar') -Algorithm SHA256).Hash) { throw 'Installed app.asar differs from the final unpacked application.' }
  if ((Get-ItemProperty -LiteralPath "HKCU:\Software\$guid").InstallLocation -ne $installDirectory) { throw 'Installer registered an unexpected installation directory.' }
  if (Test-Path -LiteralPath $shortcutPaths[0]) { throw '--no-desktop-shortcut did not suppress the desktop shortcut.' }
  $startMenu = $shortcutPaths[2]
  if (-not (Test-Path -LiteralPath $startMenu)) { throw 'Expected test start menu shortcut was not created.' }
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($startMenu)
  if ($shortcut.TargetPath -ne $installedExe) { throw 'Test start menu shortcut points outside the test installation.' }
  Write-Log 'PASS NSIS installed the final app, registered the correct test directory, and created only its expected start menu shortcut.'
  Invoke-NodeCheck @('scripts/check-git.mjs', (Join-Path $installDirectory 'resources\git')) 'git-runtime'
  $env:OOPSMD_SMOKE_EXE = $installedExe
  Invoke-NodeCheck @('scripts/smoke.mjs') 'smoke'
  Invoke-NodeCheck @('scripts/safety-smoke.mjs') 'safety-smoke'
  Invoke-NodeCheck @('scripts/clipboard-smoke.mjs') 'clipboard-smoke'
} catch {
  $failure = $_
  Write-Log "FAIL $($_.Exception.Message)"
} finally {
  $env:OOPSMD_SMOKE_EXE = $previousSmokeExe
  if ($installed) {
    try {
      $checkedRoot = Assert-ContainedDirectory $installDirectory
      $uninstaller = Join-Path $checkedRoot 'Uninstall OopsMD.exe'
      if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw 'Test uninstaller is missing; no manual recursive removal was attempted.' }
      if ((Get-ItemProperty -LiteralPath "HKCU:\Software\$guid").InstallLocation -ne $checkedRoot) { throw 'Registry installation ownership changed; refusing uninstall.' }
      foreach ($running in @(Get-Process -Name OopsMD -ErrorAction SilentlyContinue)) {
        if ($running.Path -ne (Join-Path $checkedRoot 'OopsMD.exe')) { throw 'Another OopsMD instance is running; refusing to let NSIS stop unrelated work.' }
        Stop-Process -Id $running.Id -Force
      }
      Write-Log 'RUN hidden test uninstaller /S /currentuser /KEEP_APP_DATA (no --delete-app-data).'
      $process = Start-Process -FilePath $uninstaller -ArgumentList '/S /currentuser /KEEP_APP_DATA' -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru
      Wait-TestProcess $process 120 'NSIS uninstall'
      $watch = [Diagnostics.Stopwatch]::StartNew()
      while ($watch.Elapsed.TotalSeconds -lt 60) {
        $remainingRegistry = @(Get-OopsRegistry)
        $remainingShortcuts = @($shortcutPaths | Where-Object { Test-Path -LiteralPath $_ })
        if (-not (Test-Path -LiteralPath $checkedRoot) -and -not $remainingRegistry.Count -and -not $remainingShortcuts.Count) { break }
        Start-Sleep -Milliseconds 500
      }
      if (Test-Path -LiteralPath $checkedRoot) { throw 'The test installation directory remains after uninstallation; no manual recursive removal was attempted.' }
      if (@(Get-OopsRegistry).Count) { throw 'OopsMD registry entries remain after test uninstall.' }
      foreach ($shortcutPath in $shortcutPaths) { if (Test-Path -LiteralPath $shortcutPath) { throw "Test shortcut remains: $shortcutPath" } }
      foreach ($profile in $appDataBefore) { if (-not (Test-Path -LiteralPath $profile)) { throw "Pre-existing app data directory was removed: $profile" } }
      Write-Log 'PASS uninstall removed the test program directory, registration and shortcuts; pre-existing app data was retained.'
    } catch {
      Write-Log "CLEANUP FAIL $($_.Exception.Message)"
      if (-not $failure) { $failure = $_ }
    }
  }
}
if ($failure) { throw $failure }
Write-Log 'PASS complete installed-app smoke and safety acceptance, including actual NSIS install/uninstall.'
