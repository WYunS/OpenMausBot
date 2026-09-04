$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$logRoot = Join-Path $env:LOCALAPPDATA 'OpenMausBot-Dev\logs'
$electron = Join-Path $repoRoot 'node_modules\electron\dist\electron.exe'

function Test-LocalPort([int]$Port) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    return $task.Wait(250) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Start-LocalService([string]$Script, [string]$Name) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw 'Node.js was not found.' }
  $arguments = if ($Script -eq 'dev:server') {
    @('--experimental-strip-types', (Join-Path $repoRoot 'server\index.ts'))
  } else {
    @((Join-Path $repoRoot 'node_modules\vite\bin\vite.js'))
  }
  Start-Process -FilePath $nodeCommand.Source `
    -ArgumentList $arguments `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot "$Name.log") `
    -RedirectStandardError (Join-Path $logRoot "$Name-error.log")
}

function Stop-LocalDevelopmentService([int]$Port) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $listener) { return }
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  $commandLine = [string]$owner.CommandLine
  if ($owner.Name -ne 'node.exe' -or $commandLine -notmatch '(OpenMausBot-source|vite[\\/]bin[\\/]vite\.js|server[\\/]index\.ts)') {
    throw "Port $Port is occupied by another application (PID $($listener.OwningProcess))."
  }
  Stop-Process -Id $listener.OwningProcess -Force
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline -and (Test-LocalPort $Port)) { Start-Sleep -Milliseconds 100 }
  if (Test-LocalPort $Port) { throw "The stale OpenMausBot service on port $Port did not stop." }
}

function Start-DesktopApp {
  if (-not (Test-Path -LiteralPath $electron -PathType Leaf)) {
    throw "Electron executable is missing: $electron. Run scripts\install-local-windows-shortcut.ps1."
  }

  # Launch the GUI executable itself. Going through `pnpm dev:desktop` adds a
  # detached cmd/node chain which can die silently after this hidden launcher
  # exits. Unique logs also avoid a stale process keeping the next launch from
  # opening the same redirected file.
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  return Start-Process -FilePath $electron `
    -ArgumentList @($repoRoot) `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput (Join-Path $logRoot "desktop-$stamp.log") `
    -RedirectStandardError (Join-Path $logRoot "desktop-$stamp-error.log") `
    -PassThru
}

function Show-LaunchFailure([string]$Message) {
  $errorLog = Join-Path $logRoot 'launcher-error.log'
  $details = "$(Get-Date -Format o) $Message"
  try {
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    Add-Content -LiteralPath $errorLog -Value $details
  } catch {}
  try {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.Popup(
      "OpenMausBot could not start.`n`n$Message`n`nDetails: $errorLog",
      0,
      'OpenMausBot',
      16
    )
  } catch {}
}

function Invoke-Launcher {
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  Set-Location -LiteralPath $repoRoot

  $alreadyRunning = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'electron.exe' -and
    $_.ExecutablePath -eq $electron -and
    $_.CommandLine -notlike '*--type=*'
  } | Select-Object -First 1
  if ($alreadyRunning) {
    # Restore immediately instead of running the full desktop command again.
    try {
      Add-Type -AssemblyName UIAutomationClient
      $process = Get-Process -Id $alreadyRunning.ProcessId -ErrorAction Stop
      if ($process.MainWindowHandle -eq 0) { throw 'The running process has no window yet.' }
      $window = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
      $pattern = $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
      $pattern.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)
      $shell = New-Object -ComObject WScript.Shell
      [void]$shell.AppActivate([int]$alreadyRunning.ProcessId)
    } catch {
      # Electron's single-instance event restores the window when direct UI
      # activation is unavailable during startup.
      [void](Start-DesktopApp)
    }
    return
  }

  # A closed development window must not reconnect to a server left behind by
  # another checkout or an older source revision. Cold launches own these two
  # development ports, restart known OpenMausBot services, and use absolute
  # script paths so ownership is visible in process diagnostics.
  Stop-LocalDevelopmentService 8799
  Stop-LocalDevelopmentService 5199
  Start-LocalService 'dev:server' 'server'
  Start-LocalService 'dev' 'vite'

  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline -and (-not (Test-LocalPort 8799) -or -not (Test-LocalPort 5199))) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-LocalPort 8799) -or -not (Test-LocalPort 5199)) {
    throw "Local services did not become ready. See $logRoot"
  }

  $env:CUA_DRIVER_PATH = Join-Path $repoRoot 'dist-native\cua-win32-x64\cua-driver.exe'
  $desktopProcess = Start-DesktopApp

  # A successful GUI launch remains alive. Catch immediate bootstrap failures
  # while this hidden launcher is still present so double-click never fails
  # without an explanation.
  Start-Sleep -Seconds 3
  if ($desktopProcess.HasExited) {
    throw "Desktop process exited during startup with code $($desktopProcess.ExitCode)."
  }
}

try {
  Invoke-Launcher
} catch {
  Show-LaunchFailure $_.Exception.Message
  exit 1
}
