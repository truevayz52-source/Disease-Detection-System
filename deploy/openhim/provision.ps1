# Provision the DDS channel + client in the local OpenHIM.
# Run after `docker compose -f deploy/openhim/docker-compose.yml up -d`.
$ErrorActionPreference = 'Stop'
$api = 'https://localhost:8080'
$auth = 'root@openhim.org:openhim-password'

Write-Host 'Waiting for OpenHIM API…'
$up = $false
for ($i = 0; $i -lt 60; $i++) {
    $out = curl.exe -sk --max-time 4 "$api/heartbeat" 2>$null
    if ($out -match 'master|uptime') { $up = $true; break }
    Start-Sleep -Seconds 3
}
if (-not $up) { throw 'OpenHIM API did not come up' }
Write-Host 'API is up.'

# Client — custom-token auth, used by the DDS regional bridge (Bearer token).
Write-Host 'Creating dds client…'
curl.exe -sk -u $auth -H 'content-type: application/json' -X POST "$api/clients" `
    -d '{"clientID":"dds","name":"DDS regional bridge","customTokenID":"dds-dev-token","roles":["dds-mortality"]}'

# Channel — POST /dds/mortality → echo service (dev target; swap the route
# host for the national HIE endpoint in production).
Write-Host 'Creating /dds/mortality channel…'
curl.exe -sk -u $auth -H 'content-type: application/json' -X POST "$api/channels" `
    -d '{"name":"DDS Mortality Aggregates","urlPattern":"^/dds/mortality$","type":"http","authType":"private","status":"enabled","allow":["dds"],"methods":["POST"],"routes":[{"name":"echo","host":"dds-openhim-echo","port":80,"primary":true,"type":"http","secured":false}]}'

Write-Host ''
Write-Host 'Done. Set in server/.env:'
Write-Host '  OPENHIM_BASE_URL=http://localhost:5001'
Write-Host '  OPENHIM_TOKEN=dds-dev-token'
Write-Host '  OPENHIM_CHANNEL_PATH=/dds/mortality'
