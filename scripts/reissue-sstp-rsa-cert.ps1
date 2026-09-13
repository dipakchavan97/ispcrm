# Reissue Let's Encrypt certificate for vpn.cloudsetup.in using RSA 2048
$ErrorActionPreference = "Stop"

$cfIni = Join-Path $env:USERPROFILE ".cloudflare\cloudflare.ini"
if (-not (Test-Path $cfIni)) {
    Write-Error "Cloudflare credentials file not found at: $cfIni"
    exit 1
}

$email = (git config user.email)
if (-not $email) {
    Write-Error "Operator email not configured in git config"
    exit 1
}
$email = $email.Trim()

$baseDir = Split-Path -Parent $PSScriptRoot
$etcMount = (Join-Path $baseDir "certbot_data\etc") -replace '\\', '/'
$varMount = (Join-Path $baseDir "certbot_data\var") -replace '\\', '/'
$iniMount = $cfIni -replace '\\', '/'

Write-Host "=== Requesting RSA 2048 Certificate for vpn.cloudsetup.in via Cloudflare DNS-01 ==="
$shCmdVpn = "cp /cloudflare_host.ini /tmp/cloudflare.ini && chmod 600 /tmp/cloudflare.ini && certbot certonly --dns-cloudflare --dns-cloudflare-credentials /tmp/cloudflare.ini --dns-cloudflare-propagation-seconds 30 --cert-name vpn.cloudsetup.in -d vpn.cloudsetup.in --key-type rsa --rsa-key-size 2048 --force-renewal --agree-tos -m '$email' --no-eff-email --non-interactive"

docker run --rm `
  --dns 1.1.1.1 --dns 8.8.8.8 `
  -v "${etcMount}:/etc/letsencrypt" `
  -v "${varMount}:/var/lib/letsencrypt" `
  -v "${iniMount}:/cloudflare_host.ini:ro" `
  --entrypoint /bin/sh certbot/dns-cloudflare -c $shCmdVpn

if ($LASTEXITCODE -ne 0) {
    Write-Error "Certbot execution failed with exit code $LASTEXITCODE"
    exit 1
}

Write-Host "=== Locating latest RSA certificate files in archive ==="
$sstpArchive = Join-Path $baseDir "certbot_data\etc\archive\vpn.cloudsetup.in"
$fullchains = Get-ChildItem -Path (Join-Path $sstpArchive "fullchain*.pem") | Sort-Object Name -Descending
$privkeys = Get-ChildItem -Path (Join-Path $sstpArchive "privkey*.pem") | Sort-Object Name -Descending

if ($fullchains.Count -eq 0 -or $privkeys.Count -eq 0) {
    Write-Error "No certificate archive files found in $sstpArchive"
    exit 1
}

$latestFullchain = $fullchains[0].FullName
$latestPrivkey = $privkeys[0].FullName

Write-Host "Copying $($fullchains[0].Name) to certs/sstp/fullchain.pem"
Copy-Item -Path $latestFullchain -Destination (Join-Path $baseDir "certs\sstp\fullchain.pem") -Force

Write-Host "Copying $($privkeys[0].Name) to certs/sstp/privkey.pem"
Copy-Item -Path $latestPrivkey -Destination (Join-Path $baseDir "certs\sstp\privkey.pem") -Force

Write-Host "[SUCCESS] RSA 2048 Certificate deployed to certs/sstp/"
