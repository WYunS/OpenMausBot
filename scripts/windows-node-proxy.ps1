function Add-NodeProxyBypassFromSandboxPreset {
  param([Parameter(Mandatory = $true)][string]$PresetPath)

  if (-not (Test-Path -LiteralPath $PresetPath -PathType Leaf)) { return }
  try {
    $preset = Get-Content -Raw -LiteralPath $PresetPath | ConvertFrom-Json
    $manager = [Uri][string]$preset.managerUrl
    if (-not $manager.IsAbsoluteUri -or $manager.Scheme -notin @('http', 'https') -or -not $manager.Host) { return }
    $entries = @($env:NO_PROXY -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($entries -notcontains $manager.Host) {
      $env:NO_PROXY = (@($manager.Host) + $entries) -join ','
    }
  } catch {
    # The bootstrap validator reports malformed private configuration later.
    # Proxy setup must not print or otherwise expose its request payload.
  }
}
