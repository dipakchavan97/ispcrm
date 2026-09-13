# ISPCRM PRODUCTION DEPLOYMENT AUDIT

**Date:** September 12, 2026  
**Auditor:** Antigravity Principal Systems Architect & DevOps Engineer  
**Codebase:** ISP CRM, Billing, FreeRADIUS AAA, SSTP Concentrator & MikroTik RouterOS Orchestrator  
**Status:** **AUDIT COMPLETE — ZERO DESTRUCTIVE CHANGES**

---

## 1. Current Architectural Landscape

The project is an established, feature-complete ISP CRM, Billing, and Network Orchestration platform structured as an npm/Turborepo monorepo:

```
ISPCRM Monorepo
├── apps/
│   ├── web/        (Next.js 14, React 18, Tailwind CSS, TanStack Query) -> PORT 3000
│   ├── api/        (NestJS 10 Modular Monolith, Swagger, Axios, node:net) -> PORT 4000
│   └── worker/     (BullMQ 5, Redis, Async Billing & CoA Processor) -> PORT 4001
├── packages/
│   ├── database/   (Prisma ORM 5.15, PostgreSQL 16 client, migrations, seeds)
│   └── shared/     (Common TypeScript DTOs, Enums, Interfaces, Validation)
└── infrastructure/
    ├── freeradius/ (FreeRADIUS 3.2, PostgreSQL raddb integration) -> UDP 1812, 1813, 3799
    └── sstp/       (accel-pppd v1.14.0, MS-SSTP, TLS 1.2/1.3, In-Kernel PPP) -> TCP 443, 2001
```

---

## 2. Component-by-Component Deployment Audit

| Component | Technology | Runtime Characteristics | Primary Dependencies | Deployment Target |
| :--- | :--- | :--- | :--- | :--- |
| **`apps/web`** | Next.js 14.2 | Client-side React SPA / Server Components; stateless HTTP requests. | Connects to `apps/api` via HTTP/S using `NEXT_PUBLIC_API_URL`. | **Vercel** |
| **`apps/api`** | NestJS 10 | Long-running Node.js process; persistent raw TCP sockets (`node:net`) for RouterOS Binary API; kernel route manipulation (`10.200.0.0/16`). | PostgreSQL, Redis, Shared Volume (`/etc/ppp/chap-secrets`), In-kernel routes. | **Linux VPS** |
| **`apps/worker`**| BullMQ 5 | Continuous background worker; polling Redis queues, executing cron-like expiry sweeps, processing RADIUS CoA tasks. | Redis, PostgreSQL, Network access to NAS. | **Linux VPS** |
| **`sstp`** | `accel-pppd` 1.14 | Low-level Linux daemon terminating MS-SSTP connections over TCP 443; kernel PPP device `/dev/ppp`, MPPE encryption, IPCP routing. | Linux kernel modules (`ppp_generic`, `ppp_mppe`, `tun`), Shared Volume `/etc/ppp`. | **Linux VPS** (Root/Host or Privileged Docker) |
| **`freeradius`** | FreeRADIUS 3.2 | Real-time AAA server responding to UDP authentication (1812), accounting (1813), and sending CoA/PoD packets (3799). | PostgreSQL (`radius` schema), Network route to BNGs. | **Linux VPS** |
| **`database`** | PostgreSQL 16 | Relational store with ACID compliance, relational schemas for CRM and RADIUS (`radcheck`, `radreply`, `radacct`). | Persistent SSD storage. | **Linux VPS / Managed Postgres** |
| **`cache/queue`**| Redis 7 | In-memory queue broker for BullMQ, rate-limiting store, session caching. | Persistent disk (AOF/RDB). | **Linux VPS / Managed Redis** |

---

## 3. Strict Deployment Boundary Analysis

### 3.1 Why Vercel is Strictly Limited to `apps/web`
* **Incompatible with SSTP/PPP:** Vercel operates ephemeral serverless functions (AWS Lambda). It has no access to `/dev/ppp`, cannot bind raw TCP 443 for stateful MS-SSTP handshakes, and cannot hold persistent tunnel sessions.
* **Incompatible with Persistent RouterOS Sockets:** RouterOS Binary API (port 8728) uses long-lived stateful TCP connections. Serverless timeouts and cold starts would constantly break API sessions.
* **Incompatible with UDP RADIUS:** Vercel cannot accept or route inbound UDP 1812/1813 packets.
* **Vercel-Compatible Portion:** The Next.js web application (`apps/web`) is 100% compatible with Vercel. It communicates exclusively via REST (`apiFetch`) to the backend API over HTTPS.

### 3.2 Why the Linux VPS Must Host the Persistent Network Gateway
* **accel-pppd SSTP Concentrator:** Requires in-kernel PPP (`/dev/ppp`), Linux network administration privileges (`NET_ADMIN`), and persistent binding to public TCP 443.
* **Private Management Routing (`10.200.0.0/16`):** The Linux VPS hosts the internal gateway interface (`10.200.0.1`), allowing the NestJS API container to route directly to any connected MikroTik (`10.200.0.6`) with sub-3ms latency.
* **BullMQ Worker & Expiry Cron:** Requires a permanent Node.js event loop to process subscription expiry checks, invoice generation, and real-time CoA queues.
* **FreeRADIUS Engine:** Needs static IP reachability for NAS clients and constant access to PostgreSQL.

---

## 4. Environment Variables & Secret Inventory

### 4.1 Frontend Environment (`apps/web`)
| Variable | Required In | Purpose | Production Example |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_API_URL` | Build / Runtime | Base URL for REST API | `https://api.yourdomain.com/api` |
| `NEXT_PUBLIC_APP_NAME`| Runtime | Branding title | `ISPCRM Portal` |

### 4.2 Backend Environment (`apps/api`)
| Variable | Sensitive | Purpose | Production Requirements |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | No | Environment selector | Must be `production` |
| `PORT` | No | HTTP listening port | `4000` |
| `DATABASE_URL` | **YES** | Prisma connection string | `postgresql://user:pass@host:5432/ispcrm?schema=public&sslmode=prefer` |
| `REDIS_HOST` | No | Redis hostname | `redis` (Docker) or `127.0.0.1` |
| `REDIS_PORT` | No | Redis port | `6379` |
| `REDIS_PASSWORD` | **YES** | Redis AUTH password | High-entropy random secret (>=32 chars) |
| `JWT_SECRET` | **YES** | JWT token signing key | Must be >= 32 high-entropy characters |
| `ROUTER_ENCRYPTION_KEY`| **YES** | AES-256-GCM key for router credentials | Exactly 32 bytes (64 hex characters) |
| `CORS_ALLOWED_ORIGINS` | No | Allowed frontend domains | `https://app.yourdomain.com,https://yourdomain.com` |
| `SSTP_SERVER_HOST` | No | Public SSTP hostname for scripts | `vpn.yourdomain.com` |
| `SSTP_SERVER_PORT` | No | Public SSTP port | `443` |
| `SSTP_CA_CERT_PATH` | No | Path to TLS CA / Public cert | `/etc/ssl/sstp/ca.crt` (or Let's Encrypt root) |
| `SSTP_CHAP_SECRETS_PATH`| No | Shared volume path | `/etc/ppp/chap-secrets` |
| `SSTP_SERVICE_HOST` | No | Internal Docker/VPS SSTP gateway | `sstp` |

### 4.3 Background Worker Environment (`apps/worker`)
| Variable | Sensitive | Purpose | Production Requirements |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | No | Production mode | `production` |
| `WORKER_PORT` | No | Health check port | `4001` |
| `DATABASE_URL` | **YES** | Prisma DB connection | Same as API |
| `REDIS_HOST` | No | Redis hostname | Same as API |
| `REDIS_PORT` | No | Redis port | Same as API |
| `REDIS_PASSWORD` | **YES** | Redis AUTH | Same as API |

---

## 5. Network Ports & Transport Requirements

| Service | Protocol | Port | Scope | Exposure |
| :--- | :--- | :--- | :--- | :--- |
| **Web UI** | HTTPS | 443 | Public | Hosted by Vercel (`app.yourdomain.com`) |
| **REST API** | HTTPS | 443 (via proxy) | Public | VPS Reverse Proxy (`api.yourdomain.com`) -> internal 4000 |
| **SSTP VPN** | TCP | 443 | Public | VPS Host / `ispcrm-sstp` (`vpn.yourdomain.com`) |
| **FreeRADIUS Auth** | UDP | 1812 | Restricted | Public WAN or internal management VLAN |
| **FreeRADIUS Acct** | UDP | 1813 | Restricted | Public WAN or internal management VLAN |
| **FreeRADIUS CoA** | UDP | 3799 | Outbound | Egress from VPS to MikroTik `10.200.0.x:3799` |
| **RouterOS API** | TCP | 8728 | **Strictly Internal** | Inside SSTP tunnel (`10.200.0.0/16`) only |
| **PostgreSQL** | TCP | 5432 | **Internal Only** | Docker network (`ispcrm-net`) / localhost only |
| **Redis** | TCP | 6379 | **Internal Only** | Docker network (`ispcrm-net`) / localhost only |
| **SSH** | TCP | 22 (or custom) | Restricted | Host administration (Key-based only) |

---

## 6. Single Public IP Coexistence: Port 443 Architecture

In a production VPS with a single public IPv4 address, both **REST API HTTPS (`api.yourdomain.com:443`)** and **SSTP VPN (`vpn.yourdomain.com:443`)** share TCP port 443.

### Gold-Standard Solution: TLS SNI Demultiplexing
Using HAProxy or Nginx Stream with `ssl_preread`:
```
                             Internet Client / MikroTik
                                         │
                                   Inbound TCP 443
                                         ▼
                            [HAProxy / Nginx Stream]
                          (inspects TLS SNI in-flight)
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
         SNI: vpn.domain.com                             SNI: api.domain.com
                 │                                               │
                 ▼                                               ▼
      [ispcrm-sstp:443]                              [Nginx / Caddy Proxy]
  accel-pppd terminates MS-SSTP                  Terminates TLS (Let's Encrypt)
         (Port 8443)                                             │
                                                                 ▼
                                                        [ispcrm-api:4000]
```
* **Why this is optimal:**
  1. Both services use the standard port 443 (no custom ports required on MikroTik or client browsers).
  2. The SSTP daemon terminates its own TLS using the valid certificate.
  3. The REST API is secured behind a hardened reverse proxy with gzip, rate limiting, and HTTP/2 support.

---

## 7. Risks & Pre-Deployment Blockers

1. **Let's Encrypt Renewal for accel-pppd:** `accel-pppd` reads certificates from disk at startup. A renewal hook (`certbot renew --post-hook`) must reload or restart `accel-pppd` to prevent certificate expiry.
2. **Linux Kernel PPP Support:** VPS provider must support native kernel PPP modules (`CONFIG_PPP=y`, `CONFIG_PPP_MPPE=y`). KVM, Bare Metal, and standard Linode/DigitalOcean/Hetzner VMs support this natively. OpenVZ/LXC without `/dev/ppp` passthrough must be avoided.
3. **Database Migration Safety:** Production deployments must execute `npx prisma migrate deploy` (or `db push` for initial state) before starting API/worker containers to avoid race conditions.
4. **CORS Configuration:** Backend `CORS_ALLOWED_ORIGINS` must explicitly match the Vercel production domain (`https://app.yourdomain.com`) to prevent browser fetch blocks.
