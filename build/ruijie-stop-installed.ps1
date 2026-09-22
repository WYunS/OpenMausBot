param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference = 'Stop'

# Only terminate executable images physically located in this installation.
# Do not kill by executable name: a separate Harness may be doing other work.
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if (-not [IO.Path]::IsPathRooted($root) -or $root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\')) {
  throw 'Refusing an invalid installation root'
}
# Runner TEMP (and some user profiles) uses an 8.3 alias such as RUNNER~1.
# Either side can report a short or long spelling; normalize both before comparing.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class RuijieInstallPath {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetLongPathName(string shortPath, StringBuilder longPath, uint length);
}
'@
$longPath = New-Object Text.StringBuilder 32768
$pathLength = [RuijieInstallPath]::GetLongPathName($root, $longPath, $longPath.Capacity)
if ($pathLength -eq 0 -or $pathLength -ge $longPath.Capacity) { throw 'Cannot resolve the installation path' }
$root = $longPath.ToString().TrimEnd('\')
$marker = Join-Path $root 'resources\enterprise-release.json'
if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
  throw 'Refusing to stop processes without the enterprise installation marker'
}
$metadata = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
if ($metadata.repository -notin @('AI-Applications-Team/OpenMausBot', 'WYunS/OpenMausBot')) {
  throw 'Unexpected installation repository'
}
$prefix = $root + '\'
for ($attempt = 0; $attempt -lt 10; $attempt++) {
  $owned = @(Get-CimInstance Win32_Process | Where-Object {
    if ($_.ExecutablePath) {
      $imagePath = New-Object Text.StringBuilder 32768
      $imageLength = [RuijieInstallPath]::GetLongPathName($_.ExecutablePath, $imagePath, $imagePath.Capacity)
      $imageLength -gt 0 -and $imageLength -lt $imagePath.Capacity -and
        $imagePath.ToString().StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
    }
  })
  if ($owned.Count -eq 0) { exit 0 }
  foreach ($entry in $owned) {
    # NSIS launches 32-bit PowerShell. Get-Process.Path can be empty for a
    # 64-bit image; use CIM for both reads and guard against PID reuse.
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.ProcessId)"
    if ($current -and $current.ExecutablePath -eq $entry.ExecutablePath -and $current.CreationDate -eq $entry.CreationDate) {
      try { Stop-Process -Id $entry.ProcessId -Force -ErrorAction Stop }
      catch {
        if (Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue) { throw }
      }
    }
  }
  Start-Sleep -Milliseconds 500
}
throw 'Processes from this installation did not stop'
