# Starts the Cloudflare quick tunnel and publishes its URL to Firebase RTDB
# so the mobile app always resolves the current public address.
#
#   powershell -File deploy\start-tunnel.ps1 -RtdbUrl <URL> -ApiKey <KEY>
#
#   -RtdbUrl   e.g. https://<project>-default-rtdb.firebaseio.com
#   -ApiKey    Firebase Web API key (Project settings → General)
#   -Port      local API port (default 4001)
#
# Run this INSTEAD of `cloudflared tunnel --url ...` — it forwards the local
# API and keeps the Firebase pointer fresh on every restart.

param(
  [Parameter(Mandatory=$true)][string]$RtdbUrl,
  [Parameter(Mandatory=$true)][string]$ApiKey,
  [int]$Port = 4001
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$syncScript = Join-Path $repoRoot "deploy\sync-tunnel-url.mjs"
$published = $false

& $cloudflared tunnel --url "http://localhost:$Port" 2>&1 | ForEach-Object {
  Write-Output $_
  if (-not $published -and $_ -match 'https://[\w\-]+\.trycloudflare\.com') {
    $published = $true
    $apiUrl = "$($Matches[0])/api"
    Write-Output "[tunnel] publishing $apiUrl"
    node $syncScript $RtdbUrl $ApiKey $apiUrl
  }
}
