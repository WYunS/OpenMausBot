param(
  [string]$ShortcutPath = ''
)

$ErrorActionPreference = 'Stop'
$appName = ([string][char]0x9510) + ([char]0x6377) + 'Bot'
if (-not $ShortcutPath) {
  $ShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName.lnk"
}

function Invoke-BuildTool {
  # PowerShell 5.1 surfaces anything a native tool writes to stderr as a
  # NativeCommandError record, and with $ErrorActionPreference = 'Stop' that
  # aborts the script before the exit code can be read -- even for tools that
  # merely log warnings and then succeed. Drop to 'Continue' for the call and
  # judge the result by $LASTEXITCODE, which is what these tools actually
  # communicate through. Output is captured so a failure can be reported.
  #
  # -Arguments is bound by name at every call site. Do not add
  # ValueFromRemainingArguments: Windows PowerShell 5.1 collects remaining
  # arguments into a nested array, which would silently collapse them into one.
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @()
  )

  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    # Out-String yields an empty string for an empty pipeline, but cast anyway
    # so a null can never turn a tool's success into a method-call exception.
    $script:BuildToolOutput = ([string](& $FilePath @Arguments 2>&1 | Out-String)).Trim()
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $PSScriptRoot 'OpenMausBot.DevLauncher.cs'
$launcher = Join-Path $PSScriptRoot 'OpenMausBot.DevLauncher.exe'
# Keep a branded filename so Explorer cannot reuse the stock Electron shortcut
# icon cached under the generic icon.ico resource path.
$icon = Join-Path $repoRoot 'build\icon-ruijie-orb-depth.ico'
$propertyWriter = Join-Path $PSScriptRoot 'set-windows-shortcut-app-id.ps1'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$electronSource = Join-Path $repoRoot 'node_modules\electron\dist\electron.exe'
$privateRuntime = "$electronSource.private"
# Same shelf name the launcher uses, so either script can recover a swap the
# other was interrupted mid-way through.
$shelvedRuntime = Join-Path (Split-Path -Parent $electronSource) 'electron.previous.tmp'
# Recover from a run that was interrupted mid-swap below: if the shelved copy
# is the only runtime left on disk, put it back before the existence check.
# Guarded so a failure here still reaches the friendlier check further down.
try {
  if (
    (Test-Path -LiteralPath $shelvedRuntime -PathType Leaf) -and
    -not (Test-Path -LiteralPath $electronSource -PathType Leaf)
  ) {
    Move-Item -LiteralPath $shelvedRuntime -Destination $electronSource -Force
  }
} catch {}
$localDevelopmentAppId = 'com.openmausbot.app.localdev.source'
$resourceEditor = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'node_modules\.pnpm') `
    -Directory -Filter 'rcedit@*' -ErrorAction SilentlyContinue |
  ForEach-Object { Join-Path $_.FullName 'node_modules\rcedit\bin\rcedit.exe' } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1

foreach ($required in @($source, $icon, $propertyWriter, $compiler, $electronSource)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Required development-launcher file is missing: $required"
  }
}
if (-not $resourceEditor) { throw 'rcedit.exe is missing from the development dependencies.' }

# Keep the executable name Electron uses to identify a source checkout as a
# development app, but brand this checkout's runtime. Windows otherwise falls
# back to the stock atom icon after a cold taskbar rebuild.
#
# An already-branded runtime needs nothing: skip a 150MB+ copy and a full
# resource rewrite on every rerun.
$branded = $false
try {
  $branded = (Get-Item -LiteralPath $electronSource).VersionInfo.ProductName -eq $appName
} catch {}

if (-not $branded) {
  # pnpm hard-links node_modules into its global content-addressable store, so
  # branding electron.exe in place would rewrite the runtime every other
  # checkout on this machine shares. Replacing the directory entry with a
  # private copy first breaks that link and leaves the store pristine. This is
  # a hard prerequisite, not a best-effort step: editing a still-linked runtime
  # is exactly the kind of machine-wide side effect this script must not have.
  $unlinked = $false
  $unlinkError = ''
  for ($attempt = 0; $attempt -lt 5 -and -not $unlinked; $attempt += 1) {
    try {
      Copy-Item -LiteralPath $electronSource -Destination $privateRuntime -Force
      # Move-Item -Force onto the live path would delete it before moving, so a
      # sharing violation on the second half would leave no runtime at all.
      # Shelve the original aside first and roll back if the swap fails.
      Remove-Item -LiteralPath $shelvedRuntime -Force -ErrorAction SilentlyContinue
      Move-Item -LiteralPath $electronSource -Destination $shelvedRuntime -Force
      try {
        Move-Item -LiteralPath $privateRuntime -Destination $electronSource -Force
        $unlinked = $true
      } catch {
        Move-Item -LiteralPath $shelvedRuntime -Destination $electronSource -Force
        throw
      }
    } catch {
      # A locked runtime is the expected reason to land here, but disk-full or
      # ACL failures look identical from the loop. Keep the real message so the
      # throw below does not tell the user to close an app that is not running.
      $unlinkError = $_.Exception.Message
      Start-Sleep -Milliseconds 300
    } finally {
      if (Test-Path -LiteralPath $privateRuntime -PathType Leaf) {
        Remove-Item -LiteralPath $privateRuntime -Force -ErrorAction SilentlyContinue
      }
      # Keep the shelved original unless a runtime is back in place: if both the
      # swap and its rollback failed it is the last copy on disk, and discarding
      # it would leave a checkout only `pnpm install` could repair.
      if (
        (Test-Path -LiteralPath $shelvedRuntime -PathType Leaf) -and
        (Test-Path -LiteralPath $electronSource -PathType Leaf)
      ) {
        Remove-Item -LiteralPath $shelvedRuntime -Force -ErrorAction SilentlyContinue
      }
    }
  }
  if (-not $unlinked) {
    throw (
      'The development runtime could not be replaced (close ' + $appName +
      ' if it is running). ' + $unlinkError
    )
  }

  $brandingExit = Invoke-BuildTool -FilePath $resourceEditor -Arguments @(
    $electronSource,
    '--set-icon', $icon,
    '--set-version-string', 'ProductName', $appName,
    '--set-version-string', 'FileDescription', $appName,
    '--set-version-string', 'InternalName', $appName,
    '--set-version-string', 'OriginalFilename', 'electron.exe'
  )
  $branded = $brandingExit -eq 0
}
if (-not $branded) {
  throw "The OpenMausBot development runtime could not be branded. $script:BuildToolOutput"
}

# The csc.exe shipped in the .NET Framework directory predates Roslyn and has
# no /deterministic switch, so every compile embeds a fresh module GUID and
# emits different bytes for identical source. scripts\ is inside the desktop
# preview's source fingerprint, so recompiling unconditionally invalidates the
# build receipt and forces a full tsc+vite rebuild on the very next launch --
# which is why repairing the icon used to make the app start slowly. Rebuild
# the launcher only when its own inputs actually changed.
$launcherInputStamp = @($source, $icon) |
  ForEach-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc } |
  Sort-Object -Descending | Select-Object -First 1
$launcherIsCurrent = (Test-Path -LiteralPath $launcher -PathType Leaf) -and
  ((Get-Item -LiteralPath $launcher).LastWriteTimeUtc -ge $launcherInputStamp)
if (-not $launcherIsCurrent) {
  $compileExit = Invoke-BuildTool -FilePath $compiler -Arguments @(
    '/nologo',
    '/target:winexe',
    "/win32icon:$icon",
    "/out:$launcher",
    '/reference:System.Windows.Forms.dll',
    $source
  )
  if ($compileExit -ne 0 -or -not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw "The OpenMausBot development launcher could not be compiled. $script:BuildToolOutput"
  }
}

$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('StartMenu')) "Programs\$appName.lnk"
$startupShortcut = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)) "$appName.lnk"

foreach ($destination in @($ShortcutPath, $startMenuShortcut, $startupShortcut)) {
  $shortcutDirectory = Split-Path -Parent $destination
  New-Item -ItemType Directory -Path $shortcutDirectory -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($destination)
  $shortcut.TargetPath = $launcher
  $shortcut.Arguments = ''
  $shortcut.WorkingDirectory = $repoRoot
  $shortcut.IconLocation = "$icon,0"
  $shortcut.Description = "$appName local development"
  $shortcut.Save()

  & $propertyWriter `
    -ShortcutPath $destination `
    -AppId $localDevelopmentAppId `
    -RelaunchCommand ('"' + $launcher + '"') `
    -RelaunchDisplayName $appName `
    -RelaunchIcon "$icon,0"
}

# Ask Explorer to re-read the updated shortcut/icon registration. This keeps
# the existing user session intact while replacing a cached Electron atom on
# the taskbar after development-runtime branding changes.
$iconRefresh = Join-Path $env:WINDIR 'System32\ie4uinit.exe'
if (Test-Path -LiteralPath $iconRefresh -PathType Leaf) {
  Invoke-BuildTool -FilePath $iconRefresh -Arguments @('-show') | Out-Null
}

Write-Output $ShortcutPath
