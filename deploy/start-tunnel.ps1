# Starts the Cloudflare quick tunnel and publishes its URL to a stable pointer
# so the mobile app always resolves the current public address.
#
#   powershell -File deploy\start-tunnel.ps1
#   powershell -File deploy\start-tunnel.ps1 -RepoUrl https://github.com/<owner>/<repo>.git
#   powershell -File deploy\start-tunnel.ps1 -RtdbUrl <URL> -ApiKey <KEY>   # Firebase instead
#
#   -RepoUrl   Git remote used for the `tunnel-pointer` branch (default:
#              this repo's origin). The app reads the raw file:
#              raw.githubusercontent.com/<owner>/<repo>/tunnel-pointer/api_url.json
#   -RtdbUrl   e.g. https://<project>-default-rtdb.firebaseio.com
#   -ApiKey    Firebase Web API key (Project settings → General)
#   -Port      local API port (default 4001)
#
# Run this INSTEAD of `cloudflared tunnel --url ...` — it forwards the local
# API and keeps the pointer fresh on every restart.

param(
  [string]$RepoUrl = "",
  [string]$RtdbUrl = "",
  [string]$ApiKey = "",
  [int]$Port = 4001
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$useFirebase = $RtdbUrl -ne "" -and $ApiKey -ne ""

if (-not $useFirebase) {
    if ($RepoUrl -eq "") {
        $RepoUrl = (git -C $repoRoot remote get-url origin 2>$null)
        if (-not $RepoUrl) { throw "No -RepoUrl given and no git origin found" }
    }
    $syncArgs = @("deploy\sync-tunnel-github.mjs", $RepoUrl)
} else {
    $syncArgs = @("deploy\sync-tunnel-url.mjs", $RtdbUrl, $ApiKey)
}

$published = $false
& $cloudflared tunnel --url "http://localhost:$Port" 2>&1 | ForEach-Object {
  Write-Output $_
  if (-not $published -and $_ -match 'https://[\w\-]+\.trycloudflare\.com') {
    $published = $true
    $apiUrl = "$($Matches[0])/api"
    Write-Output "[tunnel] publishing $apiUrl"
    $script = Join-Path $repoRoot $syncArgs[0]
    node $script $syncArgs[1] $syncArgs[2] $apiUrl
  }
}
