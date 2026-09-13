# ISPCRM SECURE INTERNET DEPLOYMENT PLAN
## Dedicated Production Deployment for `cloudsetup.in` (PC Public IP: `103.170.1.125`)

**Document Version:** 2.0.0 (Revised)  
**Target Domain:** `cloudsetup.in`  
**Host Public IPv4:** `103.170.1.125/32` (Interface: `Broadband Connection`)  
**Operating System:** Windows 10 Pro 64-bit with Docker Desktop (WSL2 Kernel 5.15)  
**Lead Architect:** Antigravity Principal Cloud & Network Security Architect  
**Status:** **AWAITING OPERATOR APPROVAL — ZERO CHANGES APPLIED**  

---

## 1. System Topology & Traffic Architecture

```
                    cloudsetup.in
                          |
                ┌─────────┴─────────┐
                │                   │
       app.cloudsetup.in     vpn.cloudsetup.in
                │                   │
              HTTPS              SSTP TCP/443
                │                   │
                └─────────┬─────────┘
                          │
                   103.170.1.125
                          │
                    ISPCRM PC
                          │
                  SNI Reverse Proxy
                    /           \
                   /             \
                WEB/API        accel-ppp
                                  │
                              SSTP VPN
                                  │
                         Multiple MikroTiks
```

### Architectural Highlights:
1. **Single IPv4 Demultiplexing:** `app.cloudsetup.in:443` and `vpn.cloudsetup.in:443` share `103.170.1.125:443` through non-decrypting Layer-4 TLS SNI preread routing.
2. **SSTP Passthrough:** `vpn.cloudsetup.in` TCP traffic is passed directly through to `ispcrm-sstp:443`. `accel-pppd` performs its own TLS handshake, MS-SSTP negotiation, and in-kernel PPP framing.
3. **Same-Origin Web/API on Port 443:** The browser accesses both the CRM Web UI (`/`) and the REST API (`/api/`) over standard HTTPS on port 443. Port 4000 is completely removed from public exposure.
4. **Zero Impact on Existing Project:** The existing tenant-subdomain infrastructure of `cloudsetup.in` is completely untouched.

---

## 2. Cloudflare DNS Configuration

> [!CAUTION]
> **EXISTING PROJECT SAFETY:**
> `cloudsetup.in` currently hosts another project using wildcard/tenant subdomains (`*.cloudsetup.in`).
> - **DO NOT modify, delete, or replace any existing DNS records.**
> - Explicit subdomain records (`app` and `vpn`) take strict precedence over wildcard records per RFC 1034 / 4592.

### Exact Records to Add in Cloudflare DNS:

| Type | Name | Content / Target | Proxy Status | TTL | Architectural Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **A** | `app` | `103.170.1.125` | **DNS only (Gray Cloud)** | Auto / 300 | Web Admin Portal & Same-Origin REST API |
| **A** | `vpn` | `103.170.1.125` | **DNS only (Gray Cloud)** | Auto / 300 | SSTP Concentrator for MikroTik Routers |

### Proxy Status Rules:
* **`vpn.cloudsetup.in` — MUST BE DNS-ONLY (Gray Cloud):**
  Cloudflare's HTTP proxy does not support raw SSTP encapsulation (`SSTP_DUPLEX_POST`, PPP LCP, MS-CHAPv2, MPPE). Putting `vpn` behind Orange Cloud will break SSTP connections immediately.
* **`app.cloudsetup.in` — DNS-Only initially (Gray Cloud):**
  Ensures direct TLS handshake and seamless Let's Encrypt validation. Once verified, it can optionally be switched to Proxied (Orange Cloud) with SSL mode set to **Full (strict)**.

---

## 3. Same-Origin API Architecture (Eliminating Port 4000)

### 3.1 Problem Identified in Audit
The compiled Next.js client bundle contains logic in `getApiBase()` that falls back to:
`window.location.protocol + "//" + window.location.hostname + ":4000/api"`
when `process.env.NEXT_PUBLIC_API_URL` is undefined.

### 3.2 Native Production Build Configuration (No HTML Workarounds)
1. Rather than relying on Nginx `sub_filter` or runtime DOM injection, the build configuration was corrected natively within the Next.js project:
   - `apps/web/.env.production` defines `NEXT_PUBLIC_API_URL=/api`.
   - `apps/web/next.config.mjs` injects `env: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '/api' }` into the Webpack compile pipeline.
   - `apps/web/Dockerfile` sets `ARG NEXT_PUBLIC_API_URL=/api` and `ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}` during both build and runtime stages.
   - `apps/web/src/lib/api.ts` defines `getApiBase()` to return `process.env.NEXT_PUBLIC_API_URL || '/api'`, completely eliminating all `:4000/api` string references.
2. When the production Next.js bundle is generated, Webpack directly inlines `function getApiBase() { return "/api"; }`.
3. In the browser, all API queries are dispatched as **same-origin relative URLs**:
   `https://app.cloudsetup.in/api/auth/me`
   `https://app.cloudsetup.in/api/customers`
   `https://app.cloudsetup.in/api/plans`
4. Nginx receives traffic on port 443 and proxies `/api/` to `http://ispcrm-api:4000/api/` over the internal Docker network.
5. **Verified Build Integrity:** Automated verification confirms **zero** `:4000/api` or `:4000` references remain anywhere in the production client bundle. Port 4000 is completely private.

---

## 4. Port Allocation Matrix: Public vs Private

| Port | Protocol | Container | Target Host Exposure | Windows Firewall | Visibility Justification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **443** | TCP | `ispcrm-proxy` | **0.0.0.0:443** | **ALLOW** | **Primary Public Ingress.** Multiplexes Web HTTPS and SSTP VPN. |
| **80** | TCP | `ispcrm-proxy` | **0.0.0.0:80** | **ALLOW (Conditional)** | Required only for ACME HTTP-01 and HTTP->HTTPS redirect. |
| **3000** | TCP | `ispcrm-web` | **NONE** | **BLOCK** | **Private.** Reached only via Nginx reverse proxy on `ispcrm-frontend-net`. |
| **4000** | TCP | `ispcrm-api` | **NONE** | **BLOCK** | **Private.** Reached only via Nginx reverse proxy on `ispcrm-frontend-net`. |
| **4001** | TCP | `ispcrm-worker`| **NONE** | **BLOCK** | **Private.** BullMQ worker health check. Zero public access. |
| **2001** | TCP | `ispcrm-sstp` | **127.0.0.1:2001** | **BLOCK** | **Private (Host Loopback).** `accel-cmd` telnet CLI. Strictly internal. |
| **5432** | TCP | `ispcrm-postgres`| **NONE** | **BLOCK** | **Private.** Relational DB. Shielded inside `ispcrm-backend-net`. |
| **6379** | TCP | `ispcrm-redis` | **NONE** | **BLOCK** | **Private.** Cache and queue broker. Password protected via `requirepass`. |
| **1812** | UDP | `ispcrm-freeradius`| **127.0.0.1:1812** | **BLOCK** | **Private.** Routers query RADIUS over SSTP VPN (`10.200.0.1:1812`). |
| **1813** | UDP | `ispcrm-freeradius`| **127.0.0.1:1813** | **BLOCK** | **Private.** PPPoE accounting travels inside SSTP VPN (`10.200.0.1:1813`). |
| **3799** | UDP | `ispcrm-freeradius`| **NONE** | **BLOCK** | **Private.** CoA packets are outbound to routers. Inbound port blocked. |

---

## 5. Docker Network Architecture

The stack uses three isolated Docker bridge networks defined in `docker-compose.internet.yml`:

1. **`ispcrm-frontend-net`:**
   - Members: `ispcrm-proxy`, `ispcrm-web`, `ispcrm-api`
   - Purpose: Ingress routing for Web and API traffic.
2. **`ispcrm-vpn-net`:**
   - Members: `ispcrm-proxy`, `ispcrm-sstp`, `ispcrm-api`, `ispcrm-freeradius`
   - Purpose: Layer-4 SSTP stream passthrough, router VPN tunnels (`10.200.0.0/16`), and in-tunnel RADIUS AAA.
3. **`ispcrm-backend-net`:**
   - Members: `ispcrm-api`, `ispcrm-worker`, `ispcrm-freeradius`, `ispcrm-postgres`, `ispcrm-redis`
   - Purpose: Isolated data and queue plane. `ispcrm-web` and `ispcrm-proxy` have NO interface on this network.

---

## 6. Public TLS Certificate Strategy

Both `app.cloudsetup.in` and `vpn.cloudsetup.in` require publicly trusted certificates (e.g. Let's Encrypt).

### Method A: DNS-01 via Cloudflare API (Recommended — Zero Open Inbound Ports)
* Certbot creates and verifies temporary DNS TXT records via Cloudflare API.
* **Advantages:**
  * Port 80 does not need to be opened on the Windows PC.
  * Completely non-disruptive to TCP 443 and active SSTP VPN tunnels.
* **Command:**
  ```bash
  certbot certonly --dns-cloudflare \
    --dns-cloudflare-credentials /path/to/cloudflare.ini \
    -d app.cloudsetup.in -d vpn.cloudsetup.in
  ```

### Method B: HTTP-01 via Nginx Webroot
* Certbot places tokens in `./certbot_www`, served by Nginx on port 80.
* Does not require a Cloudflare API token, but requires TCP port 80 allowed inbound on Windows Firewall during renewals.

### Certificate Deployment:
* Web Application: Mount certificates to `./certs/app/fullchain.pem` and `./certs/app/privkey.pem`.
* SSTP Concentrator: Mount certificates to `./certs/sstp/fullchain.pem` and `./certs/sstp/privkey.pem`.

---

## 7. Windows Firewall Configuration Policy

Rules are explicitly scoped to `-InterfaceAlias "Broadband Connection"` (Profile: `Public`):

```powershell
# 1. ALLOW TCP 443 (HTTPS & SSTP SNI Reverse Proxy)
New-NetFirewallRule -DisplayName "ISPCRM-Inbound-HTTPS-SSTP" `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 `
    -InterfaceAlias "Broadband Connection" `
    -Description "Allow public HTTPS and SSTP traffic to ISPCRM reverse proxy"

# 2. ALLOW TCP 80 (Conditional: Only if HTTP-01 ACME challenge is used)
New-NetFirewallRule -DisplayName "ISPCRM-Inbound-HTTP-ACME" `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80 `
    -InterfaceAlias "Broadband Connection" `
    -Description "Allow public HTTP for ACME verification and redirect"

# 3. EXPLICIT BLOCK RULES (Defense-in-Depth on Broadband Interface)
New-NetFirewallRule -DisplayName "ISPCRM-Block-Database-Postgres" `
    -Direction Inbound -Action Block -Protocol TCP -LocalPort 5432 -InterfaceAlias "Broadband Connection"

New-NetFirewallRule -DisplayName "ISPCRM-Block-Cache-Redis" `
    -Direction Inbound -Action Block -Protocol TCP -LocalPort 6379 -InterfaceAlias "Broadband Connection"

New-NetFirewallRule -DisplayName "ISPCRM-Block-SSTP-Management-CLI" `
    -Direction Inbound -Action Block -Protocol TCP -LocalPort 2001 -InterfaceAlias "Broadband Connection"

New-NetFirewallRule -DisplayName "ISPCRM-Block-Internal-Apps" `
    -Direction Inbound -Action Block -Protocol TCP -LocalPort 3000,4000,4001 -InterfaceAlias "Broadband Connection"

New-NetFirewallRule -DisplayName "ISPCRM-Block-FreeRADIUS-UDP" `
    -Direction Inbound -Action Block -Protocol UDP -LocalPort 1812,1813,3799 -InterfaceAlias "Broadband Connection"
```

---

## 8. Physical MikroTik SSTP Endpoint Integration

### 8.1 Configuration Details
* **Endpoint Hostname:** `vpn.cloudsetup.in`
* **Port:** `443`
* **TLS Certificate Validation:** `verify-server-certificate=yes`
* **Target Router:** `RB4011iGS+` (RouterOS 6.49.20 long-term)

### 8.2 Production Coexistence Guarantee
* `XCEEDNET_SSTP` remains active and running (`R`) with zero packet loss.
* Physical PPPoE subscriber sessions and RADIUS accounting (`172.16.1.12`) remain 100% untouched.
* The new `sstp-ispcrm` interface connects parallel to XceedNet.
* `add-default-route=no` ensures existing WAN internet routing is preserved.

### 8.3 MikroTik Update Command (Execute only after public TLS is live):
```routeros
/interface sstp-client set [find name="sstp-ispcrm"] connect-to="vpn.cloudsetup.in" port=443 verify-server-certificate=yes disabled=no
```

---

## 9. Step-by-Step Deployment Order

1. **Step 1: Operator Approves Plan** (Confirm domain, DNS records, and firewall rules).
2. **Step 2: Add Cloudflare DNS Records** (Add `app` and `vpn` as `A` records pointing to `103.170.1.125` with Proxy = DNS only).
3. **Step 3: Obtain Let's Encrypt Public Certificates** (Issue certs for `app.cloudsetup.in` and `vpn.cloudsetup.in` via DNS-01 or HTTP-01 and place in `./certs/app/` and `./certs/sstp/`).
4. **Step 4: Apply Windows Firewall Rules** (Execute PowerShell commands from Section 7).
5. **Step 5: Launch Internet Docker Stack**
   ```bash
   docker compose -f docker-compose.internet.yml build proxy
   docker compose -f docker-compose.yml down
   docker compose -f docker-compose.internet.yml up -d
   ```
6. **Step 6: End-to-End Verification**
   - Test Web: Visit `https://app.cloudsetup.in` in browser (check SSL padlock and login).
   - Test Same-Origin API: Verify browser console makes calls to `https://app.cloudsetup.in/api/*` with zero 404/CORS errors.
   - Test SSTP Handshake: Verify TLS handshake to `vpn.cloudsetup.in:443`.
7. **Step 7: Update MikroTik Router**
   - Point `sstp-ispcrm` interface to `vpn.cloudsetup.in:443`.
   - Verify tunnel state is `R` (running) and RouterOS Binary API responds over `10.200.0.6:8728`.

---

## 10. Rollback Procedure

If any issue occurs during the maintenance window:
```bash
# 1. Stop the internet stack
docker compose -f docker-compose.internet.yml down

# 2. Restart the previous verified stack
docker compose -f docker-compose.yml up -d
```
```powershell
# 3. Revert firewall rules if needed
Remove-NetFirewallRule -DisplayName "ISPCRM-*"
```
```routeros
# 4. Revert MikroTik to direct link if needed
/interface sstp-client set [find name="sstp-ispcrm"] connect-to="172.18.23.172" port=443
```
*Physical subscriber services and XceedNet configuration remain untouched throughout.*

---

## 11. Potential Blockers & Pre-Flight Checklist

1. **Cloudflare Record Approval:** `app.cloudsetup.in` and `vpn.cloudsetup.in` must be created in Cloudflare before TLS certificates can be requested.
2. **TLS Certificate Issuance:** Certificates must be generated and placed in `./certs/app/` and `./certs/sstp/` before starting `ispcrm-proxy` and `ispcrm-sstp`.
3. **Elevated PowerShell Access:** Windows Firewall rule creation requires Administrator privileges.
4. **Zero Disruptive Changes in Progress:** All live containers are currently healthy and awaiting your approval to begin the staged transition.
