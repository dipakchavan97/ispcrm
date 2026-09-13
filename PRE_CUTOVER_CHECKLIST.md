# PRE-CUTOVER CHECKLIST: ISPCRM INTERNET EXPOSURE

**Target Domain:** `cloudsetup.in`  
**Target Subdomains:** `app.cloudsetup.in` (Web & REST API), `vpn.cloudsetup.in` (SSTP VPN Concentrator)  
**Public Host IPv4:** `103.170.1.125`  
**Date Evaluated:** 2026-09-12T21:03:00+05:30  
**Stack State:** Development stack running intact (`ispcrm-web`, `ispcrm-api`, `ispcrm-worker`, `ispcrm-freeradius`, `ispcrm-postgres`, `ispcrm-redis`, `ispcrm-sstp`).  

---

## 1. Pre-Cutover Status Matrix

| Check Item | Status | Verification Detail / Technical Evidence |
| :--- | :---: | :--- |
| **DNS `app.cloudsetup.in` resolves to `103.170.1.125`** | **PASS** | Authoritative query to `keanu.ns.cloudflare.com` returns `103.170.1.125`. |
| **DNS `vpn.cloudsetup.in` resolves to `103.170.1.125`** | **PASS** | Authoritative query to `keanu.ns.cloudflare.com` returns `103.170.1.125`. |
| **`app` is DNS-only** | **PASS** | Single origin IP `103.170.1.125` returned (No Cloudflare Edge CDN Anycast IPs). |
| **`vpn` is DNS-only** | **PASS** | Single origin IP `103.170.1.125` returned (No Cloudflare Edge CDN Anycast IPs). |
| **Existing wildcard untouched** | **PASS** | Query for `randomtenant987.cloudsetup.in` against `keanu.ns.cloudflare.com` resolves directly to Cloudflare Anycast IPs (`172.67.153.208`, `104.21.82.59`). Existing project wildcard is completely unimpacted. |
| **Public certificate for `app` obtained** | **PASS** | Valid Let's Encrypt production certificate issued via DNS-01 and saved to `./certs/app/fullchain.pem` and `./certs/app/privkey.pem`. |
| **Public certificate for `vpn` obtained** | **PASS** | Valid Let's Encrypt production certificate issued via DNS-01 and saved to `./certs/sstp/fullchain.pem` and `./certs/sstp/privkey.pem`. |
| **`app` certificate SAN verified** | **PASS** | `openssl x509` verified: Subject Alternative Name = `DNS:app.cloudsetup.in`, Issuer = `Let's Encrypt (YE1)`, Expires = `Dec 11 14:54:26 2026 GMT`. Key match verified. |
| **`vpn` certificate SAN verified** | **PASS** | `openssl x509` verified: Subject Alternative Name = `DNS:vpn.cloudsetup.in`, Issuer = `Let's Encrypt (YE1)`, Expires = `Dec 11 14:53:25 2026 GMT`. Key match verified. |
| **Nginx syntax valid** | **PASS** | `nginx -t` passed with exit code 0 (`syntax is ok`, `test is successful`). |
| **SNI configuration valid** | **PASS** | `stream ssl_preread on` demultiplexes Layer 4 without decrypting: `vpn.cloudsetup.in` -> raw TCP `ispcrm-sstp:443`, `app.cloudsetup.in` -> `127.0.0.1:8443`. |
| **Docker Compose syntax valid** | **PASS** | `docker compose -f docker-compose.internet.yml config --quiet` passed with exit code 0. |
| **PostgreSQL backup verified** | **PASS** | Backup file created (`backups/ispcrm_pre_cutover_backup.dump`, 439 KB). Verified via dry-run restore into test database (`367 customers`, `93 routers` restored and verified). |
| **No secrets committed** | **PASS** | `.gitignore` updated with `certs/`, `certbot_data/`, `backups/`, `*.dump`, `*.pem`, `*.key`, `*.ini`, `.cloudflare/`. Git status clean of secrets. |
| **Only TCP 443 intended for public exposure** | **PASS** | In `docker-compose.internet.yml`, only `443:443` is published on `proxy`. Port 80 removed. All backends (5432, 6379, 3000, 4000, 4001) have no host port bindings. Ports 2001, 1812, 1813 are bound strictly to `127.0.0.1`. |
| **Firewall rule restricted to Broadband Connection** | **PASS** | Rule syntax specifies `-InterfaceAlias "Broadband Connection" -LocalPort 443 -Protocol TCP -Action Allow`. Broad interface rules avoided. |
| **Physical MikroTik untouched** | **PASS** | Physical router (`103.170.1.22`) configuration intact. Zero API or Winbox commands issued. |
| **XCEEDNET untouched** | **PASS** | Interface `XCEEDNET_SSTP` remains running and untouched. |
| **Existing RADIUS untouched** | **PASS** | Production subscriber RADIUS configuration (`172.16.1.12`) remains untouched. |

---

## 2. Technical Details & Execution Procedures

### A. Corrected Certbot DNS-01 Procedure (Fixing Symlink & Persistence Issues)

Certbot creates symlinks in `/etc/letsencrypt/live/<domain>/` that point to relative paths in `/etc/letsencrypt/archive/<domain>/` (e.g. `../../archive/<domain>/fullchain1.pem`). If only `/live/` is mounted, these symlinks break inside Windows and downstream containers.

#### Robust Persistent Procedure:
1. Mount a dedicated local persistence directory (`certbot_data/`) for the complete Certbot tree.
2. Run Certbot DNS-01 using a least-privilege Cloudflare API token.
3. Dereference and copy the actual `.pem` files directly into `./certs/app/` and `./certs/sstp/`.

```powershell
# 1. Create directory structure
New-Item -ItemType Directory -Force -Path .\certbot_data\etc, .\certbot_data\var, .\certs\app, .\certs\sstp

# 2. Run Certbot for app.cloudsetup.in using persistent volume mounts
docker run --rm `
  -v ${PWD}/certbot_data/etc:/etc/letsencrypt `
  -v ${PWD}/certbot_data/var:/var/lib/letsencrypt `
  -v ${env:USERPROFILE}/.cloudflare/cloudflare.ini:/cloudflare.ini:ro `
  certbot/dns-cloudflare certonly `
  --dns-cloudflare `
  --dns-cloudflare-credentials /cloudflare.ini `
  --dns-cloudflare-propagation-seconds 30 `
  -d app.cloudsetup.in `
  --agree-tos `
  -m [OPERATOR_EMAIL] `
  --no-eff-email

# 3. Run Certbot for vpn.cloudsetup.in
docker run --rm `
  -v ${PWD}/certbot_data/etc:/etc/letsencrypt `
  -v ${PWD}/certbot_data/var:/var/lib/letsencrypt `
  -v ${env:USERPROFILE}/.cloudflare/cloudflare.ini:/cloudflare.ini:ro `
  certbot/dns-cloudflare certonly `
  --dns-cloudflare `
  --dns-cloudflare-credentials /cloudflare.ini `
  --dns-cloudflare-propagation-seconds 30 `
  -d vpn.cloudsetup.in `
  --agree-tos `
  -m [OPERATOR_EMAIL] `
  --no-eff-email

# 4. Copy actual dereferenced certificate and private key files
Copy-Item -Path .\certbot_data\etc\live\app.cloudsetup.in\fullchain.pem -Destination .\certs\app\fullchain.pem -Force
Copy-Item -Path .\certbot_data\etc\live\app.cloudsetup.in\privkey.pem   -Destination .\certs\app\privkey.pem   -Force

Copy-Item -Path .\certbot_data\etc\live\vpn.cloudsetup.in\fullchain.pem -Destination .\certs\sstp\fullchain.pem -Force
Copy-Item -Path .\certbot_data\etc\live\vpn.cloudsetup.in\privkey.pem   -Destination .\certs\sstp\privkey.pem   -Force
```

#### Certificate SAN & Date Verification Commands:
```powershell
# Verify app.cloudsetup.in certificate
openssl x509 -in .\certs\app\fullchain.pem -noout -subject -issuer -dates
openssl x509 -in .\certs\app\fullchain.pem -noout -ext subjectAltName

# Verify vpn.cloudsetup.in certificate
openssl x509 -in .\certs\sstp\fullchain.pem -noout -subject -issuer -dates
openssl x509 -in .\certs\sstp\fullchain.pem -noout -ext subjectAltName
```

---

### B. Least-Privilege Cloudflare API Token Guidelines

* **Location:** Save token on host at `$env:USERPROFILE\.cloudflare\cloudflare.ini` (NOT in repository):
  ```ini
  dns_cloudflare_api_token = <TOKEN_STRING>
  ```
* **Scope Constraints:**
  * **Permissions:** `Zone - DNS - Edit` ONLY.
  * **Zone Resources:** `Include - Specific zone - cloudsetup.in` ONLY.
  * **Client IP Address Filtering (Optional):** Restrict to `103.170.1.125`.
* **Zero Exposure:** Never use the Global API key. Never commit `cloudflare.ini`. Never output the token string.

---

### C. Interface-Restricted Windows Firewall Rule

Execute in an elevated Administrator PowerShell prompt:
```powershell
New-NetFirewallRule -DisplayName "ISPCRM Public HTTPS/SSTP Ingress (TCP 443)" `
  -Direction Inbound `
  -InterfaceAlias "Broadband Connection" `
  -Protocol TCP `
  -LocalPort 443 `
  -Action Allow
```
* **Security Validation:** Restricts ingress strictly to the public WAN adapter (`Broadband Connection`). Does NOT expose internal adapters or Docker virtual adapters. Network category remains untouched (`Public`).

---

### D. Layer 4 SNI & Port Isolation Summary

* **Incoming Port:** `103.170.1.125:443` (TCP 443 ONLY).
* **Demultiplexer:** Nginx Stream Module (`ssl_preread on;`):
  * SNI `vpn.cloudsetup.in` → Raw TCP forwarded directly to `ispcrm-sstp:443` (Terminated by `accel-pppd` with SSTP handshake, MS-CHAPv2, and MPPE).
  * SNI `app.cloudsetup.in` (or default) → Forwarded to `127.0.0.1:8443` (Nginx terminates TLS, routes `/api/*` to `ispcrm-api:4000`, and `/*` to `ispcrm-web:3000`).
* **Non-Exposed Services:**
  * `5432` (PostgreSQL) — Internal only (`ispcrm-backend-net`).
  * `6379` (Redis) — Internal only (`ispcrm-backend-net`).
  * `3000` (Web UI) — Internal only (`ispcrm-frontend-net`).
  * `4000` (REST API) — Internal only (`ispcrm-frontend-net`, `ispcrm-backend-net`, `ispcrm-vpn-net`).
  * `4001` (Worker) — Internal only (`ispcrm-backend-net`).
  * `2001` (CLI) — Host loopback `127.0.0.1:2001` only.
  * `1812/1813` (RADIUS) — Host loopback `127.0.0.1:1812:1812/udp` only; MikroTik routes inside SSTP tunnel (`10.200.0.1:1812`).
  * `80` — Completely removed from published ports.

---

## 3. Pre-Cutover Readiness Status

* **Technical Blockers:** **NONE.** All DNS records, production certificates, key matching, trust chain, SNI routing, Nginx syntax, and Docker Compose configurations are validated (100% PASS).
* **Next Action:** Awaiting explicit operator authorization before executing container transition (`docker compose down` -> `docker compose -f docker-compose.internet.yml up -d --build`) and Windows Firewall rule creation.
