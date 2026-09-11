# System Architecture: Multi-Tenant ISP CRM, Billing & Bandwidth Management SaaS

## 1. Executive Summary

This platform is a production-oriented, modular monolith SaaS tailored specifically for small-to-medium Indian Internet Service Providers (ISPs). It centralizes subscriber lifecycle management, automated recurring billing (with Indian GST compliance), PPPoE authentication, bandwidth policy enforcement, and MikroTik router synchronization under a unified platform.

With a 7-day MVP timeline, the architecture strictly adheres to a **modular monolith** paradigm: single repository, shared types, isolated domain modules, background asynchronous processing via BullMQ, and co-located PostgreSQL database serving both CRM and FreeRADIUS 3.x engines.

---

## 2. High-Level Architectural Diagram

```mermaid
graph TB
    subgraph Client Layer
        Web["Next.js Web Admin (apps/web)<br/>Tailwind + shadcn/ui"]
        CustomerPortal["Customer Self-Service (Future)"]
    end

    subgraph Edge & Ingress
        ReverseProxy["Nginx / Traefik / Docker Gateway"]
    end

    subgraph Application Monolith (apps/api - NestJS)
        API_Gateway["API Gateway & Auth Guard"]
        TenantsMod["Tenant / Org Module"]
        CustomersMod["Customer / PPPoE Module"]
        PlansMod["Internet Plan Module"]
        BillingMod["Billing & GST Invoice Module"]
        RoutersMod["MikroTik Router Module"]
        RadiusSyncMod["FreeRADIUS Provisioning Module"]
        AuditMod["Audit Logging Module"]
    end

    subgraph Async Workers (apps/worker - BullMQ)
        BillingWorker["Invoice Generation & Due Check"]
        CoAWorker["PoD / CoA Disconnect Worker"]
        RouterSyncWorker["MikroTik Router Sync Worker"]
    end

    subgraph Data & State Storage
        Postgres[(PostgreSQL 16)<br/>- CRM Schema (Prisma)<br/>- FreeRADIUS Tables (rlm_sql)]
        RedisCache[(Redis 7)<br/>- BullMQ Queues<br/>- Session Cache & Rate Limiting]
    end

    subgraph Network Access Control (Infrastructure)
        FreeRADIUS["FreeRADIUS 3.x (rlm_sql)<br/>Ports 1812 (Auth), 1813 (Acct)"]
        MikroTik["MikroTik RouterOS (NAS)<br/>PPPoE Server + CoA Port 3799"]
        Subscriber["Subscriber ONT / Router<br/>PPPoE Client"]
    end

    %% Interactions
    Web -->|HTTPS / REST| ReverseProxy
    ReverseProxy --> API_Gateway
    API_Gateway --> TenantsMod
    API_Gateway --> CustomersMod
    API_Gateway --> PlansMod
    API_Gateway --> BillingMod
    API_Gateway --> RoutersMod
    API_Gateway --> RadiusSyncMod
    API_Gateway --> AuditMod

    Apps_Shared[(packages/shared)] -.-> API_Gateway
    Apps_Shared -.-> Web
    Apps_Shared -.-> Async Workers

    API_Gateway -->|Read / Write| Postgres
    API_Gateway -->|Enqueue Jobs| RedisCache
    RedisCache --> Async Workers
    Async Workers --> Postgres

    %% Network & Subscriber Auth Flow
    Subscriber -->|PPPoE Discovery & Session| MikroTik
    MikroTik -->|RADIUS Access-Request (UDP 1812)| FreeRADIUS
    FreeRADIUS -->|Query radcheck & radreply| Postgres
    FreeRADIUS -->|Access-Accept + Mikrotik-Rate-Limit| MikroTik
    MikroTik -->|RADIUS Accounting Start/Stop (UDP 1813)| FreeRADIUS
    FreeRADIUS -->|Write radacct| Postgres

    %% Disconnect / Suspension Flow
    CoAWorker -->|Disconnect-Request / PoD (UDP 3799)| MikroTik
```

---

## 3. Core Architectural Principles

1. **Modular Monolith, Zero Microservices Complexity**:
   - Single NestJS backend codebase (`apps/api`) containing bounded contexts as standard NestJS modules (`@Module`).
   - Strong boundaries enforced through internal interfaces, DTOs, and domain services.
   - Low latency, transactional integrity via single database connection pool, and simplified debugging.

2. **Tenant Isolation Strategy (Row-Level Security & Org Scoping)**:
   - Shared database, shared schema model for MVP velocity and cost efficiency.
   - Every tenant-scoped entity contains an indexed `organizationId` foreign key.
   - Tenant context resolved early in the NestJS request lifecycle via custom guard/interceptor from JWT claims or `X-Organization-Id` header.
   - Prisma middleware / extension injects tenant filters automatically on all domain queries to prevent data leakage.

3. **Hybrid Database Co-Location for FreeRADIUS**:
   - FreeRADIUS 3.x uses standard SQL tables (`radcheck`, `radreply`, `radacct`, `radusergroup`, `nas`).
   - Rather than spinning up a separate MySQL or isolated database, the FreeRADIUS tables reside in the same PostgreSQL database as the CRM tables.
   - The CRM API directly updates `radcheck` (passwords, status) and `radreply` (rate-limit attributes) within local database transactions whenever a customer is created, suspended, or plan changed.
   - Zero webhook latency or sync drift: FreeRADIUS reads live credentials directly.

4. **Event-Driven Asynchronous Network Operations**:
   - Long-running or network I/O operations (transmitting RFC 3576/5176 CoA/PoD packets to MikroTik routers, syncing address lists, batch invoice generation) are decoupled via BullMQ and Redis.
   - Web requests return instantly (202 Accepted / 200 OK) while background workers handle network retries, timeouts, and logging.

---

## 4. Module Boundaries & Responsibilities

| Module | Location | Responsibilities |
|---|---|---|
| **AuthModule** | `apps/api/src/modules/auth` | Admin authentication, JWT signing, password hashing (bcrypt), refresh tokens, role-based access control (RBAC: SuperAdmin, OrgAdmin, Operator, Technician). |
| **TenantsModule** | `apps/api/src/modules/tenants` | Organization onboarding, company profile, GST configuration, currency (INR), branding, timezone. |
| **CustomersModule** | `apps/api/src/modules/customers` | Subscriber CRM, contact details, KYC, installation address, assigned PPPoE credentials, current status (ACTIVE, SUSPENDED, EXPIRED). |
| **PlansModule** | `apps/api/src/modules/plans` | Internet plans definition, download/upload speeds (Mbps), validity period (days), pricing (excl/incl GST), data caps (FUP), burst rate policies. |
| **SubscriptionsModule** | `apps/api/src/modules/subscriptions` | Customer plan bindings, activation date, expiration tracking, auto-renewal settings, plan upgrades/downgrades. |
| **InvoicesModule** | `apps/api/src/modules/invoices` | Automated GST-compliant tax invoices, HSN/SAC codes (998422 for Internet Telecommunication Services), invoice PDF metadata, due date management. |
| **PaymentsModule** | `apps/api/src/modules/payments` | Cash collection logging, UPI reference capture, payment gateway reconciliation hooks, receipt generation, auto-activation of suspended accounts upon receipt. |
| **RoutersModule** | `apps/api/src/modules/routers` | MikroTik NAS inventory, IP address, RADIUS shared secret, API port (8728/8729), CoA/PoD port (3799), health heartbeat. |
| **RadiusModule** | `apps/api/src/modules/radius` | Management of `radcheck`, `radreply`, and live session monitoring via `radacct`. Disconnect packet transmission (CoA/PoD) using UDP socket client. |
| **AuditModule** | `apps/api/src/modules/audit` | Immutable audit trail recording admin actions, actor ID, affected entity, timestamp, IP address, and change diff. |
| **HealthModule** | `apps/api/src/modules/health` | Liveness and readiness probes (`/api/health`, `/api/health/db`, `/api/health/redis`) using NestJS Terminus. |

---

## 5. Network Lifecycle Workflows

### 5.1 PPPoE Subscriber Authentication Flow
1. Subscriber router powers on and sends PPPoE Active Discovery Initiation (PADI).
2. MikroTik Router (acting as PPPoE Server / NAS) negotiates PPPoE session and initiates PAP/CHAP auth.
3. MikroTik sends a `RADIUS Access-Request` (UDP 1812) to FreeRADIUS with username and password.
4. FreeRADIUS queries PostgreSQL `radcheck` for `Cleartext-Password` / `Crypt-Password`.
5. If valid and not suspended:
   - FreeRADIUS queries `radreply` and returns `Access-Accept` with vendor-specific attributes:
     - `Mikrotik-Rate-Limit = "20M/50M 0/0 0/0 0/0 8 0/0"` (Upload/Download)
     - `Framed-IP-Address` or `Framed-Pool`
6. If suspended or credentials invalid:
   - FreeRADIUS returns `Access-Reject`.

### 5.2 Automated Expiry & Suspension Flow
1. BullMQ scheduler runs an hourly job in `apps/worker` querying subscriptions where `endDate < NOW()` and `status == 'ACTIVE'`.
2. Worker updates subscription status to `SUSPENDED` and customer status to `SUSPENDED`.
3. Worker sets `radcheck.value = 'SUSPENDED_REJECT'` or changes user group to `SUSPENDED_POOL`.
4. Worker queues a `RadiusDisconnectJob` to the CoA queue.
5. Worker transmits an RFC 3576 / RFC 5176 **Packet of Disconnect (PoD / Disconnect-Request)** to the customer's active MikroTik router at port 3799 with the subscriber's username and Framed-IP.
6. MikroTik tears down the active PPPoE interface immediately.
7. Next time the subscriber router retries PPPoE dial, RADIUS responds with `Access-Reject` (or assigns a walled-garden captive portal IP pool).

### 5.3 Payment & Reactivation Flow
1. Operator records payment in CRM or payment is processed via UPI.
2. Invoices module marks invoice as `PAID` and updates Subscription `status = 'ACTIVE'`, calculating a new `endDate`.
3. Customer status updated to `ACTIVE`.
4. RadiusModule restores valid password in `radcheck` and plan rate limits in `radreply`.
5. Worker sends CoA or PoD if customer was on walled garden, allowing instantaneous reconnection at full speed.
6. Audit log entry recorded with transaction reference.

---

## 6. Security, Compliance & Resiliency

1. **Authentication & Authorization**:
   - Stateless JWT tokens (short-lived access tokens + refresh tokens stored securely in HTTP-only cookies or authorization headers).
   - Role-Based Access Control (RBAC) enforced on every API route via `@Roles()` decorator.
2. **Indian Tax & Regulatory Compliance**:
   - Invoices include mandatory SAC code `998422` (Internet Access Services), ISP GSTIN, customer GSTIN (for B2B), CGST/SGST/IGST breakdown.
   - Standard audit logs retain IP assignment and MAC addresses recorded from RADIUS accounting packets (`Calling-Station-Id`) for telecom regulatory verification.
3. **Data Integrity & Health Probes**:
   - Foreign key cascading and strict unique constraints prevent duplicate PPPoE usernames across the ISP or network.
   - Docker container health checks ensure dependent services (PostgreSQL, Redis) are healthy before web, api, and worker start accepting traffic.
