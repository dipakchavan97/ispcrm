# PUBLIC EXPOSURE & PERIMETER SECURITY PLAN
## Windows PC Internet Hardening | Broadband Connection (`103.170.1.125`)

**Date:** September 12, 2026  
**Interface:** `Broadband Connection` (Network Category: `Public`)  
**Static Public IPv4:** `103.170.1.125/32`  
**Lead Architect:** Antigravity Principal Cloud & Network Security Architect  
**Status:** **AWAITING OPERATOR APPROVAL — ZERO CHANGES APPLIED**  

---

## 1. Perimeter Exposure Principles

1. **Strict Minimization of Public Surface:**
   The only host port exposed to the public Internet is **TCP 443** (plus temporary/conditional TCP 80 if ACME HTTP-01 validation is utilized).
2. **Elimination of Port 4000:**
   The raw NestJS API port 4000 is **NOT** exposed publicly. All frontend API queries flow same-origin over **TCP 443** (`https://app.cloudsetup.in/api/*`).
3. **Defense-in-Depth:**
   Security does not rely solely on Docker port configuration or solely on Windows Firewall. Both layers independently block all unauthorized ports.
4. **Non-Disruption of Docker Desktop / WSL2:**
   Rules are applied surgically to `-InterfaceAlias "Broadband Connection"`, avoiding modifications to internal vEthernet (WSL) adapters or general Docker Desktop NAT mechanics.

---

## 2. Port Categorization & Visibility Matrix

| Port | Protocol | Target Service | Host Exposure | Windows Firewall Action | Visibility Justification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **443** | TCP | `ispcrm-proxy` | **0.0.0.0:443** | **ALLOW** | **Public Entrypoint.** SNI router demultiplexes Web HTTPS (`app`) and SSTP VPN (`vpn`). |
| **80** | TCP | `ispcrm-proxy` | **0.0.0.0:80** | **ALLOW (Conditional)** | Used only for Let's Encrypt HTTP-01 challenge and HTTP->HTTPS 301 redirect. Not needed if DNS-01 is used. |
| **4000** | TCP | `ispcrm-api` | **NONE (Internal)** | **BLOCK** | **Private.** Raw NestJS REST API. Routed internally via Nginx `/api/` over port 443. |
| **3000** | TCP | `ispcrm-web` | **NONE (Internal)** | **BLOCK** | **Private.** Next.js Web UI. Routed internally via Nginx `/` over port 443. |
| **4001** | TCP | `ispcrm-worker`| **NONE (Internal)** | **BLOCK** | **Private.** BullMQ background worker health check. Has zero external endpoints. |
| **2001** | TCP | `ispcrm-sstp` | **127.0.0.1:2001** | **BLOCK** | **Private (Host Loopback).** `accel-cmd` telnet management CLI. Absolutely forbidden on public WAN. |
| **5432** | TCP | `ispcrm-postgres`| **NONE (Internal)** | **BLOCK** | **Private.** Primary relational store and RADIUS DB. Shielded inside `ispcrm-backend-net`. |
| **6379** | TCP | `ispcrm-redis` | **NONE (Internal)** | **BLOCK** | **Private.** BullMQ queues and session cache. Password protected via `requirepass`. |
| **1812** | UDP | `ispcrm-freeradius`| **127.0.0.1:1812** | **BLOCK** | **Private.** MikroTik router queries RADIUS over SSTP VPN (`10.200.0.1:1812`). |
| **1813** | UDP | `ispcrm-freeradius`| **127.0.0.1:1813** | **BLOCK** | **Private.** MikroTik accounting queries travel inside SSTP VPN (`10.200.0.1:1813`). |
| **3799** | UDP | `ispcrm-freeradius`| **NONE (Internal)** | **BLOCK** | **Private.** CoA/PoD packets originate outbound from CRM to router. Inbound port blocked. |
| **2375/2376**| TCP | Docker Engine | **127.0.0.1 only** | **BLOCK** | **Private.** Local Docker daemon socket. Blocked on Broadband WAN. |
| **6443** | TCP | Kubernetes API | **127.0.0.1 only** | **BLOCK** | **Private.** Local Kind/K8s control plane. Blocked on Broadband WAN. |

---

## 3. Same-Origin API Architecture (Eliminating Port 4000)

### 3.1 The Problem Identified in the Initial Audit
In the compiled client bundle of `ispcrm-web`, `getApiBase()` falls back to:
`window.location.protocol + "//" + window.location.hostname + ":4000/api"`
when `process.env.NEXT_PUBLIC_API_URL` is undefined or contains `localhost`.

### 3.2 The Native Build Configuration Solution
1. Rather than relying on Nginx `sub_filter` or runtime DOM injection, the build configuration was corrected natively within the Next.js project:
   - `apps/web/.env.production` defines `NEXT_PUBLIC_API_URL=/api`.
   - `apps/web/next.config.mjs` injects `env: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '/api' }` into the Webpack compile pipeline.
   - `apps/web/Dockerfile` sets `ARG NEXT_PUBLIC_API_URL=/api` and `ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}` during both build and runtime stages.
   - `apps/web/src/lib/api.ts` defines `getApiBase()` to return `process.env.NEXT_PUBLIC_API_URL || '/api'`, completely eliminating all `:4000/api` string references.
2. Webpack inlines `function getApiBase() { return "/api"; }` directly into the production client bundle.
3. All browser `fetch` calls are dispatched as **same-origin relative URLs**:
   `https://app.cloudsetup.in/api/auth/me`
   `https://app.cloudsetup.in/api/customers`
   `https://app.cloudsetup.in/api/routers`
4. Nginx terminates TLS on port 443 and proxies `/api/` directly to `http://ispcrm-api:4000/api/`.
5. **Result:** Port 4000 is completely eliminated from the host and firewall. Ingress is consolidated onto **TCP 443 ONLY**. Automated bundle verification confirms zero `:4000/api` references remain.

---

## 4. Docker Desktop Firewall Interaction & Conflict Resolution

### 4.1 Known Issue: Docker Desktop Rules vs SSTP
In previous testing, broad rules injected by Docker Desktop on the Windows host's `Public` network profile interfered with port binding and routing, either blocking legitimate SSTP handshake packets or exposing published ports across all interfaces.

### 4.2 The Resolution Strategy
1. **Remove Published Ports at the Compose Layer:**
   In `docker-compose.internet.yml`, the `ports:` directive is stripped from `postgres`, `redis`, `worker`, `web`, and `api`. If Docker Desktop does not have a published port mapping for 5432 or 6379, its background proxy (`wslrelay.exe`) does not listen on `0.0.0.0` on the Windows host.
2. **Explicit Block Rules Scoped to Broadband Connection:**
   In Windows Defender Firewall, **explicit Block rules take precedence over Allow rules**.
   By creating explicit Block rules bound strictly to `-InterfaceAlias "Broadband Connection"`, any packet arriving from the public Internet on 5432, 6379, 4000, 4001, 2001, 1812, 1813, or 3799 is immediately dropped at the Windows network driver layer before Docker or WSL2 can process it.
3. **Local Loopback Isolation for Management Tools:**
   The SSTP management CLI (`accel-cmd`) is bound strictly to `127.0.0.1:2001:2001`. This allows administrative scripts on the Windows PC to query SSTP session statistics without exposing port 2001 to the public WAN.

---

## 5. Exact Windows Defender Firewall Rules

> [!IMPORTANT]
> Do NOT execute these commands until you are ready to apply the network transition.

### Elevated PowerShell Commands:

```powershell
# ==============================================================================
# 1. ALLOW RULES ON BROADBAND CONNECTION (MINIMUM NECESSARY INGRESS)
# ==============================================================================

# Allow Public Inbound HTTPS & SSTP (TCP 443)
New-NetFirewallRule -DisplayName "ISPCRM-Inbound-HTTPS-SSTP" `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 `
    -InterfaceAlias "Broadband Connection" `
    -Description "Allow public HTTPS and SSTP traffic to ISPCRM reverse proxy"

# Allow Public Inbound HTTP (TCP 80) — Required for ACME HTTP-01 and HTTPS redirect
New-NetFirewallRule -DisplayName "ISPCRM-Inbound-HTTP-ACME" `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80 `
    -InterfaceAlias "Broadband Connection" `
    -Description "Allow public HTTP for ACME verification and redirect"


# ==============================================================================
# 2. EXPLICIT BLOCK RULES ON BROADBAND CONNECTION (DEFENSE-IN-DEPTH)
# ==============================================================================

# Block PostgreSQL (TCP 5432)
New-NetFirewallRule -DisplayName "ISPCRM-Block-Database-Postgres" `
    -Direction Inbound -Action Block -Protocol TCP -LocalPort 5432 `
    -InterfaceAlias "Broadband Connection" `
    -Description "Block public access to PostgreSQL"

# Block Redis (TCP 6379)
New-NetFirewallRule -DisplayName "ISPCRM-Block-Cache-Redis" `
    -Direction Inbound -Action Block -Protocol TCP -LocalPort 6379 `
    -InterfaceAlias "Broadband Connection" `
    -Description "Block public access to Redis"

# Block SSTP Management CLI (TCP 2001)
New-NetFirewallRule -DisplayName "ISPCRM-Block-SSTP-Management-CLI" `
    -Direction Inbound -Action Block -Protocol TCP -LocalPort 2001 `
    -InterfaceAlias "Broadband Connection" `
    -Description "Block public access to accel-cmd CLI"

# Block Raw Web & API Ports (TCP 3000, 4000, 4001)
New-NetFirewallRule -DisplayName "ISPCRM-Block-Internal-Apps" `
    -Direction Inbound -Action Block -Protocol TCP -LocalPort 3000,4000,4001 `
    -InterfaceAlias "Broadband Connection" `
    -Description "Block direct access to raw Web, API, and Worker daemons"

# Block FreeRADIUS UDP (UDP 1812, 1813, 3799)
New-NetFirewallRule -DisplayName "ISPCRM-Block-FreeRADIUS-UDP" `
    -Direction Inbound -Action Block -Protocol UDP -LocalPort 1812,1813,3799 `
    -InterfaceAlias "Broadband Connection" `
    -Description "Block public UDP access to FreeRADIUS"
```

---

## 6. Verification and Port Scanning Validation

After applying the configuration, verify from an external host using Nmap:

```bash
# External Nmap scan against 103.170.1.125
nmap -Pn -p 80,443,2001,3000,4000,4001,5432,6379,1812,1813,3799 103.170.1.125
```

### Expected Output:
```text
PORT     STATE    SERVICE
80/tcp   open     http
443/tcp  open     https
2001/tcp filtered dc
3000/tcp filtered ppp
4000/tcp filtered remoteanything
4001/tcp filtered newoak
5432/tcp filtered postgresql
6379/tcp filtered redis
1812/udp filtered radius
1813/udp filtered radacct
3799/udp filtered radius-dynauth
```
*Only 80 and 443 are open; all other internal ports report `filtered` (dropped silently by Windows Firewall).*
