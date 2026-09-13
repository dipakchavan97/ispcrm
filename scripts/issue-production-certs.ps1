# ISPCRM Production TLS Certificate Acquisition via Cloudflare DNS-01
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

# Ensure directories exist
$baseDir = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $baseDir "certbot_data\etc") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $baseDir "certbot_data\var") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $baseDir "certs\app") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $baseDir "certs\sstp") | Out-Null

$etcMount = (Join-Path $baseDir "certbot_data\etc") -replace '\\', '/'
$varMount = (Join-Path $baseDir "certbot_data\var") -replace '\\', '/'
$iniMount = $cfIni -replace '\\', '/'

$appLive = Join-Path $baseDir "certbot_data\etc\live\app.cloudsetup.in"
$sstpLive = Join-Path $baseDir "certbot_data\etc\live\vpn.cloudsetup.in"

if (-not (Test-Path (Join-Path $appLive "fullchain.pem"))) {
    Write-Host "=== Requesting Certificate for app.cloudsetup.in ==="
    $shCmdApp = "cp /cloudflare_host.ini /tmp/cloudflare.ini && chmod 600 /tmp/cloudflare.ini && certbot certonly --dns-cloudflare --dns-cloudflare-credentials /tmp/cloudflare.ini --dns-cloudflare-propagation-seconds 30 -d app.cloudsetup.in --agree-tos -m '$email' --no-eff-email --non-interactive"

    docker run --rm `
      --dns 1.1.1.1 --dns 8.8.8.8 `
      -v "${etcMount}:/etc/letsencrypt" `
      -v "${varMount}:/var/lib/letsencrypt" `
      -v "${iniMount}:/cloudflare_host.ini:ro" `
      --entrypoint /bin/sh certbot/dns-cloudflare -c $shCmdApp
} else {
    Write-Host "=== app.cloudsetup.in certificate already exists in certbot_data ==="
}

if (-not (Test-Path (Join-Path $sstpLive "fullchain.pem"))) {
    Write-Host "=== Requesting Certificate for vpn.cloudsetup.in ==="
    $shCmdVpn = "cp /cloudflare_host.ini /tmp/cloudflare.ini && chmod 600 /tmp/cloudflare.ini && certbot certonly --dns-cloudflare --dns-cloudflare-credentials /tmp/cloudflare.ini --dns-cloudflare-propagation-seconds 30 -d vpn.cloudsetup.in --agree-tos -m '$email' --no-eff-email --non-interactive"

    docker run --rm `
      --dns 1.1.1.1 --dns 8.8.8.8 `
      -v "${etcMount}:/etc/letsencrypt" `
      -v "${varMount}:/var/lib/letsencrypt" `
      -v "${iniMount}:/cloudflare_host.ini:ro" `
      --entrypoint /bin/sh certbot/dns-cloudflare -c $shCmdVpn
} else {
    Write-Host "=== vpn.cloudsetup.in certificate already exists in certbot_data ==="
}

$appArchive = Join-Path $baseDir "certbot_data\etc\archive\app.cloudsetup.in"
$sstpArchive = Join-Path $baseDir "certbot_data\etc\archive\vpn.cloudsetup.in"

if ((Test-Path (Join-Path $appArchive "fullchain1.pem")) -and (Test-Path (Join-Path $appArchive "privkey1.pem"))) {
    Copy-Item -Path (Join-Path $appArchive "fullchain1.pem") -Destination (Join-Path $baseDir "certs\app\fullchain.pem") -Force
    Copy-Item -Path (Join-Path $appArchive "privkey1.pem")   -Destination (Join-Path $baseDir "certs\app\privkey.pem")   -Force
    Write-Host "[OK] Copied app.cloudsetup.in certs to ./certs/app/"
} else {
    Write-Error "Failed: app.cloudsetup.in cert files missing in $appArchive"
}

if ((Test-Path (Join-Path $sstpArchive "fullchain1.pem")) -and (Test-Path (Join-Path $sstpArchive "privkey1.pem"))) {
    Copy-Item -Path (Join-Path $sstpArchive "fullchain1.pem") -Destination (Join-Path $baseDir "certs\sstp\fullchain.pem") -Force
    Copy-Item -Path (Join-Path $sstpArchive "privkey1.pem")   -Destination (Join-Path $baseDir "certs\sstp\privkey.pem")   -Force
    Write-Host "[OK] Copied vpn.cloudsetup.in certs to ./certs/sstp/"
} else {
    Write-Error "Failed: vpn.cloudsetup.in cert files missing in $sstpArchive"
}

Write-Host "Certificate acquisition completed."
