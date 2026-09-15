$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$logRoot = Join-Path $env:LOCALAPPDATA 'OpenMausBot-Dev\logs'
$electron = Join-Path $repoRoot 'node_modules\electron\dist\electron.exe'
$developmentServerPort = 38799
# Source builds intentionally require an explicit trusted control plane before
# sending SSO tokens or provisioning the secure phone tunnel. This branded
# development shortcut targets the same production service as packaged builds.
$env:OMB_CONTROL_PLANE_URL = 'https://accounts.openmausbot.com'
# Windows PowerShell 5.1 can decode a UTF-8-without-BOM script using the
# machine's legacy code page. Construct the localized directory name from
# Unicode code points so Electron and the standalone server always resolve
# the same userData path regardless of that code page.
$ruijieAppName = ([string][char]0x9510) + ([char]0x6377) + 'Bot'
$env:OMB_USER_DATA = Join-Path $env:APPDATA $ruijieAppName
$env:OMB_DATA_DIR = Join-Path $env:USERPROFILE '.openmausbot'
$env:OMB_PORT = [string]$developmentServerPort
# Let Electron own the source server so encrypted plugin credentials travel
# over the same private parent/child channel used by packaged builds.
$env:OMB_DESKTOP_SERVER = '1'
$env:OMB_DESKTOP_PREVIEW = '1'
$env:OMB_BROWSER_CONNECTION = $null

. (Join-Path $PSScriptRoot 'windows-node-proxy.ps1')

# Match packaged Bot behavior: discover the installed Harness.  Development
# Harness is launched explicitly from its own shortcut when it is the product
# under test; silently overriding the provider here makes a healthy installed
# release invisible and turns a missing development Host into a 30-second
# probe on every Bot refresh.
$env:RUIJIE_HARNESS_EXECUTABLE = $null
$env:RUIJIE_HARNESS_ARGUMENTS = $null
$env:RUIJIE_HARNESS_HOME = $null
$env:RUIJIE_HARNESS_USER_DATA_DIR = $null

# Use the same staged native pair as the Windows installer when available.
# Otherwise a source launch silently chooses system Chrome, whose daemon
# startup can time out even though the packaged headless browser works.
$stagedBrowserRoot = Join-Path $repoRoot 'dist-native\browser\win32-x64'
$stagedBrowser = Join-Path $stagedBrowserRoot 'agent-browser.exe'
$stagedChrome = Join-Path $stagedBrowserRoot 'chrome\chrome-headless-shell-win64\chrome-headless-shell.exe'
if (-not $env:OMB_AGENT_BROWSER_PATH -and -not $env:AGENT_BROWSER_EXECUTABLE_PATH -and -not $env:OMB_BROWSER_BUNDLE_DIR -and
    (Test-Path -LiteralPath $stagedBrowser -PathType Leaf) -and
    (Test-Path -LiteralPath $stagedChrome -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $stagedBrowserRoot 'manifest.json') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $stagedBrowserRoot 'licenses') -PathType Container)) {
  $env:OMB_BROWSER_BUNDLE_DIR = $stagedBrowserRoot
}

function Set-NodeSystemProxy {
  # Node's fetch does not use the Windows proxy unless env-proxy support is
  # enabled explicitly. Mirror the current per-user proxy without hard-coding
  # a local client's port, while keeping Electron's local services direct.
  $settings = Get-ItemProperty `
    -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' `
    -ErrorAction SilentlyContinue
  if (-not $settings -or $settings.ProxyEnable -ne 1) { return }

  $proxy = [string]$settings.ProxyServer
  if ($proxy.Contains('=')) {
    $entries = @{}
    foreach ($item in $proxy.Split(';', [StringSplitOptions]::RemoveEmptyEntries)) {
      $parts = $item.Split('=', 2)
      if ($parts.Count -eq 2) { $entries[$parts[0].Trim().ToLowerInvariant()] = $parts[1].Trim() }
    }
    $proxy = if ($entries.https) { $entries.https } else { $entries.http }
  }
  if (-not $proxy) { return }
  if ($proxy -notmatch '^[a-z][a-z0-9+.-]*://') { $proxy = "http://$proxy" }

  $env:NODE_USE_ENV_PROXY = '1'
  if (-not $env:HTTP_PROXY) { $env:HTTP_PROXY = $proxy }
  if (-not $env:HTTPS_PROXY) { $env:HTTPS_PROXY = $proxy }
  $localBypass = '127.0.0.1,localhost,::1'
  $env:NO_PROXY = if ($env:NO_PROXY) { "$localBypass,$env:NO_PROXY" } else { $localBypass }
}

Set-NodeSystemProxy
Add-NodeProxyBypassFromSandboxPreset `
  -PresetPath (Join-Path $repoRoot 'dist-native\ruijie-sandbox\bootstrap.json')

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
  $arguments = @((Join-Path $repoRoot 'node_modules\vite\bin\vite.js'))
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

function ConvertTo-NativeArgumentString {
  # Start-Process -ArgumentList and ProcessStartInfo.Arguments join an array
  # with plain spaces and quote nothing, so a repository path containing a
  # space would silently split into two arguments. Apply the
  # CommandLineToArgvW quoting rules ourselves.
  param([string[]]$Arguments = @())

  return (
    $Arguments | ForEach-Object {
      $value = [string]$_
      if ($value -match '[\s"]') {
        # Backslashes are literal except immediately before a quote, so double
        # any run that precedes an embedded quote or the closing quote we add.
        $escaped = ($value -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1'
        '"' + $escaped + '"'
      } elseif ($value.Length -eq 0) {
        # An empty argument still has to occupy a slot.
        '""'
      } else {
        # Unquoted arguments need no escaping at all -- doubling trailing
        # backslashes here would corrupt a plain directory path.
        $value
      }
    }
  ) -join ' '
}

function Invoke-BrandingTool {
  # rcedit and ie4uinit report success through their exit code, and PowerShell
  # 5.1 would turn anything they write to stderr into a NativeCommandError that
  # $ErrorActionPreference = 'Stop' escalates into a thrown exception before
  # that code can be read. Driving the process through System.Diagnostics
  # sidesteps the error-record path entirely and buys a wall-clock bound.
  #
  # The timeout matters more than it looks: this runs synchronously ahead of
  # the Electron launch from a console-less process, so a tool that blocks
  # forever (ie4uinit is known to wedge while Explorer is busy) would leave the
  # user clicking a shortcut that does nothing at all. Treat a timeout as a
  # failed branding attempt, not as a reason to stop launching.
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [int]$TimeoutMilliseconds = 60000
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = ConvertTo-NativeArgumentString -Arguments $Arguments
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true

  $process = [System.Diagnostics.Process]::Start($startInfo)
  try {
    if (-not $process.WaitForExit($TimeoutMilliseconds)) {
      try { $process.Kill() } catch {}
      return 1
    }
    return $process.ExitCode
  } finally {
    $process.Dispose()
  }
}

function Get-DevelopmentResourceEditor {
  # rcedit ships inside the pnpm virtual store and its directory carries the
  # version, so discover it the same way the shortcut installer does.
  return Get-ChildItem -LiteralPath (Join-Path $repoRoot 'node_modules\.pnpm') `
      -Directory -Filter 'rcedit@*' -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'node_modules\rcedit\bin\rcedit.exe' } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
}

function Repair-DevelopmentRuntimeBranding {
  # A source launch takes its Windows taskbar identity and icon from
  # electron.exe itself, and that file lives in node_modules. Every
  # `pnpm install` restores the pristine runtime from the store, silently
  # undoing the branding applied once at shortcut-install time and leaving the
  # stock Electron atom behind. Re-assert it on each cold launch so the icon
  # repairs itself instead of waiting for someone to notice and rerun
  # scripts\install-local-windows-shortcut.ps1 by hand.
  #
  # The whole body is guarded: branding is cosmetic and must never be able to
  # keep the development app from starting.
  try {
    $staging = Join-Path (Split-Path -Parent $electron) 'electron.branding.tmp'
    $shelved = Join-Path (Split-Path -Parent $electron) 'electron.previous.tmp'

    # Recover first. If a previous launch was killed between the two renames of
    # the swap below, the only runtime left on disk is the shelved one; put it
    # back before anything else goes looking for electron.exe.
    if (
      (Test-Path -LiteralPath $shelved -PathType Leaf) -and
      -not (Test-Path -LiteralPath $electron -PathType Leaf)
    ) {
      Move-Item -LiteralPath $shelved -Destination $electron -Force
    }

    $icon = Join-Path $repoRoot 'build\icon-ruijie-orb-depth.ico'
    if (-not (Test-Path -LiteralPath $icon -PathType Leaf)) { return }
    # The common case is an already-branded runtime: one cheap version read.
    if ((Get-Item -LiteralPath $electron).VersionInfo.ProductName -eq $ruijieAppName) { return }

    $resourceEditor = Get-DevelopmentResourceEditor
    if (-not $resourceEditor) { return }

    # pnpm hard-links node_modules into its global content-addressable store, so
    # editing electron.exe in place would rewrite the copy every other checkout
    # on this machine shares. Brand a private copy and swap it in: replacing the
    # directory entry breaks the link and leaves the store pristine. A failed
    # swap leaves the original untouched rather than half-branded.
    $rebranded = $false
    try {
      Copy-Item -LiteralPath $electron -Destination $staging -Force
      $brandingExit = Invoke-BrandingTool -FilePath $resourceEditor -Arguments @(
        $staging,
        '--set-icon', $icon,
        '--set-version-string', 'ProductName', $ruijieAppName,
        '--set-version-string', 'FileDescription', $ruijieAppName,
        '--set-version-string', 'InternalName', $ruijieAppName,
        '--set-version-string', 'OriginalFilename', 'electron.exe'
      )
      if ($brandingExit -eq 0) {
        # Move-Item -Force onto a live path deletes the destination first, so a
        # transient sharing violation on the second half would leave no
        # electron.exe at all and break every future launch until someone
        # reinstalls. Shelve the original under a sibling name instead: the swap
        # becomes two renames, and a failure can be rolled back.
        Remove-Item -LiteralPath $shelved -Force -ErrorAction SilentlyContinue
        Move-Item -LiteralPath $electron -Destination $shelved -Force
        try {
          Move-Item -LiteralPath $staging -Destination $electron -Force
          $rebranded = $true
        } catch {
          Move-Item -LiteralPath $shelved -Destination $electron -Force
          throw
        }
      }
    } finally {
      if (Test-Path -LiteralPath $staging -PathType Leaf) {
        Remove-Item -LiteralPath $staging -Force -ErrorAction SilentlyContinue
      }
      # Only discard the shelved original once a runtime is definitely back in
      # place. If both the swap and its rollback failed, this copy is the only
      # electron.exe left on disk and deleting it would turn a recoverable
      # hiccup into a checkout that nothing short of `pnpm install` can fix.
      if (
        (Test-Path -LiteralPath $shelved -PathType Leaf) -and
        (Test-Path -LiteralPath $electron -PathType Leaf)
      ) {
        Remove-Item -LiteralPath $shelved -Force -ErrorAction SilentlyContinue
      }
    }

    if ($rebranded) {
      # Drop Explorer's cached atom so the taskbar and shortcut agree immediately
      # rather than after the next shell restart.
      $iconRefresh = Join-Path $env:WINDIR 'System32\ie4uinit.exe'
      if (Test-Path -LiteralPath $iconRefresh -PathType Leaf) {
        Invoke-BrandingTool -FilePath $iconRefresh -Arguments @('-show') | Out-Null
      }
    }
  } catch {
    # This launcher runs without a console, so a silent failure here would be
    # undiagnosable. Leave a breadcrumb and let the app start regardless.
    try {
      Add-Content -LiteralPath (Join-Path $logRoot 'branding-error.log') `
        -Value "$(Get-Date -Format o) $($_.Exception.Message)"
    } catch {}
  }
}

function Show-LaunchFailure([string]$Message) {
  $appName = ([string][char]0x9510) + ([char]0x6377) + 'Bot'
  $errorLog = Join-Path $logRoot 'launcher-error.log'
  $details = "$(Get-Date -Format o) $Message"
  try {
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    Add-Content -LiteralPath $errorLog -Value $details
  } catch {}
  try {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.Popup(
      "$appName could not start.`n`n$Message`n`nDetails: $errorLog",
      0,
      $appName,
      16
    )
  } catch {}
}

function Invoke-Launcher {
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  Set-Location -LiteralPath $repoRoot

  # Electron is also used as a Node runtime for connector/computer proxy
  # scripts. Those helpers share the same executable path and have no
  # `--type=` flag, so executable-only detection mistakes an orphan helper for
  # the desktop app and skips starting Vite. Match the desktop's sole app-path
  # argument instead.
  $quotedDesktopCommandLine = '"' + $electron + '" ' + $repoRoot
  $plainDesktopCommandLine = $electron + ' ' + $repoRoot
  $alreadyRunning = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'electron.exe' -and
    $_.ExecutablePath -eq $electron -and
    ([string]$_.CommandLine).Trim() -in @($quotedDesktopCommandLine, $plainDesktopCommandLine)
  } | Select-Object -First 1
  if ($alreadyRunning) {
    $nodeCommand = Get-Command node.exe -ErrorAction Stop
    $freshness = Start-Process -FilePath $nodeCommand.Source `
      -ArgumentList @((Join-Path $repoRoot 'scripts\desktop-build-receipt.mjs')) `
      -WorkingDirectory $repoRoot -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logRoot 'freshness.log') `
      -RedirectStandardError (Join-Path $logRoot 'freshness-error.log') `
      -Wait -PassThru
    if ($freshness.ExitCode -ne 0) {
      throw 'Source changed. Quit the development app completely, then open this shortcut again to rebuild. Your running tasks were not stopped.'
    }
    # Let Electron's single-instance event restore, maximize and focus the
    # existing window. The short-lived second process exits normally.
    [void](Start-DesktopApp)
    return
  }

  # A closed development window must not reconnect to a server left behind by
  # another checkout or an older source revision. Electron owns the server so
  # it can pass encrypted credentials through its private child-process channel;
  # this wrapper owns only Vite.
  Stop-LocalDevelopmentService $developmentServerPort
  Stop-LocalDevelopmentService 5199
  # Preview the same compiled UI/server and native pins as the installer.
  # The receipt rejects stale source/output; no Vite-only dependency fallback.
  $nodeCommand = Get-Command node.exe -ErrorAction Stop
  # An interrupted `pnpm install` leaves the virtual store populated but the
  # node_modules entry points missing, and the only symptom is a MODULE_NOT_FOUND
  # stack trace buried in prepare-error.log -- which nobody sees, because a valid
  # build receipt keeps taking the fast path until someone happens to edit a
  # source file. Name the actual problem instead.
  foreach ($entryPoint in @(
    'node_modules\typescript\bin\tsc',
    'node_modules\vite\bin\vite.js',
    'node_modules\electron\dist\electron.exe'
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $entryPoint) -PathType Leaf)) {
      throw "Dependencies are incomplete ($entryPoint is missing). Run 'pnpm install' in $repoRoot."
    }
  }
  $prepare = Start-Process -FilePath $nodeCommand.Source `
    -ArgumentList @((Join-Path $repoRoot 'scripts\prepare-local-preview.mjs')) `
    -WorkingDirectory $repoRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot 'prepare.log') `
    -RedirectStandardError (Join-Path $logRoot 'prepare-error.log') `
    -Wait -PassThru
  if ($prepare.ExitCode -ne 0) { throw "Preview preparation failed. See $logRoot\prepare-error.log" }

  $env:CUA_DRIVER_PATH = Join-Path $repoRoot 'dist-native\cua-win32-x64\cua-driver.exe'
  # Only a cold launch owns the runtime file; a warm launch would find it
  # locked by the window it is about to focus.
  Repair-DevelopmentRuntimeBranding
  $desktopProcess = Start-DesktopApp

  # Electron starts the credential-aware source server before creating its
  # window. Keep the launcher around long enough to surface either failure.
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline -and -not $desktopProcess.HasExited -and -not (Test-LocalPort $developmentServerPort)) {
    Start-Sleep -Milliseconds 250
  }
  if ($desktopProcess.HasExited) {
    throw "Desktop process exited during startup with code $($desktopProcess.ExitCode)."
  }
  if (-not (Test-LocalPort $developmentServerPort)) {
    throw "The local bot server did not become ready. See $logRoot"
  }
}

$launcherMutex = [Threading.Mutex]::new($false, 'Local\RuijieBotDevLauncher')
$launcherLockTaken = $false
$launcherFailure = $null
try {
  try {
    # A source rebuild can legitimately exceed a minute. The first launcher
    # owns preparation and its error reporting; repeated clicks join that
    # launch instead of timing out and announcing a false startup failure.
    $launcherLockTaken = $launcherMutex.WaitOne(0)
  } catch [Threading.AbandonedMutexException] {
    $launcherLockTaken = $true
  }
  if ($launcherLockTaken) { Invoke-Launcher }
} catch {
  $launcherFailure = $_.Exception.Message
} finally {
  if ($launcherLockTaken) { $launcherMutex.ReleaseMutex() }
  $launcherMutex.Dispose()
}
# Never retain the startup lock while waiting for a user to dismiss a dialog.
# A new explicit retry must be able to start even while that old dialog exists.
if ($null -ne $launcherFailure) {
  Show-LaunchFailure $launcherFailure
  exit 1
}
