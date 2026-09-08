param(
  [string]$ShortcutPath = ''
)

$ErrorActionPreference = 'Stop'
$appName = ([string][char]0x9510) + ([char]0x6377) + 'Bot'
if (-not $ShortcutPath) {
  $ShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName.lnk"
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
$localDevelopmentAppId = 'com.openmausbot.app.localdev.source'
$resourceEditor = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'node_modules\.pnpm') -Directory -Filter 'rcedit@*' |
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
# development app, but brand this checkout's private runtime in place. Windows
# otherwise falls back to the stock atom icon after a cold taskbar rebuild.
$branded = $false
for ($attempt = 0; $attempt -lt 5 -and -not $branded; $attempt += 1) {
  & $resourceEditor $electronSource `
    --set-icon $icon `
    --set-version-string ProductName $appName `
    --set-version-string FileDescription $appName `
    --set-version-string InternalName $appName `
    --set-version-string OriginalFilename electron.exe
  $branded = $LASTEXITCODE -eq 0
  if (-not $branded) { Start-Sleep -Milliseconds 300 }
}
if (-not $branded) { throw 'The OpenMausBot development runtime could not be branded.' }

& $compiler /nologo /target:winexe "/win32icon:$icon" "/out:$launcher" /reference:System.Windows.Forms.dll $source
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  throw 'The OpenMausBot development launcher could not be compiled.'
}

$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('StartMenu')) "Programs\$appName.lnk"

foreach ($destination in @($ShortcutPath, $startMenuShortcut)) {
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
  & $iconRefresh -show
}

Write-Output $ShortcutPath
