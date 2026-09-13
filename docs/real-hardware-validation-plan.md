# Real Hardware & Network Validation Plan

**Document Version:** 1.0.0  
**Target Environment:** Production ISP Deployment with Physical MikroTik RouterOS & FreeRADIUS  
**Scope:** Complete End-to-End Real Equipment Validation Protocol  

---

## 1. Executive Summary & Objective

This document defines the exact operational and verification procedures required to validate the complete ISP CRM, Billing, FreeRADIUS AAA, and MikroTik RouterOS orchestration stack against **real physical network hardware**.

### The Core Real-World Lifecycle Workflow
```mermaid
flowchart LR
    A[Admin Login] --> B[Dashboard]
    B --> C[Create Plan 50M]
    C --> D[Add Real MikroTik]
    D --> E[Verify Router API Connection]
    E --> F[Create Customer]
    F --> G[Create PPPoE Credentials]
    G --> H[Create Subscription]
    H --> I[Generate Tax Invoice]
    I --> J[Record Payment]
    J --> K[Activate Subscription]
    K --> L[Customer PPPoE Handshake]
    L --> M[FreeRADIUS Authentication]
    M --> N[MikroTik Rate-Limit 25M/50M]
    N --> O[Plan Upgrade to 100M]
    O --> P[RADIUS CoA Rate Change 50M/100M]
    P --> Q[Suspend Customer]
    Q --> R[CoA Disconnect & Access-Reject]
    R --> S[Reactivate Customer]
    S --> T[Access-Accept Restored]
```

---

## 2. Hardware Topology & Architecture Specification

```
                  +----------------------------------------------+
                  |               OPERATOR WORKSPACE             |
                  |     Browser UI (Next.js 14) : http://:3000   |
                  +-----------------------+----------------------+
                                          |
                                          v
                  +----------------------------------------------+
                  |               ISP CRM BACKEND                |
                  |     NestJS API (Port 4000)                   |
                  |     BullMQ Worker (Port 4001)                |
                  |     PostgreSQL 16 (Port 5432)                |
                  |     Redis 7 (Port 6379)                      |
                  +-----------+----------------------+-----------+
                              |                      |
                 RouterOS REST|                      | SQL rlm_sql
               (TCP 80 / 443) |                      |
                              v                      v
                  +-----------------------+  +-------------------+
                  | REAL MIKROTIK ROUTEROS|  | FREERADIUS 3.2.x  |
                  | RB5009 / CCR2004 / CHR|  | (UDP 1812/1813)   |
                  | PPPoE Server / NAS    |  +---------+---------+
                  +-----------+-----------+            |
                              ^                        | UDP 3799 (CoA / PoD)
                              |                        |
                              +------------------------+
                              |
                    PPPoE WAN | Physical Ethernet / SFP+ Trunk
                              v
                  +-----------------------+
                  | REAL PPPoE CLIENT/CPE |
                  | ONT / Router / PC Dial|
                  +-----------------------+
```

### Physical Equipment & Service Interconnects

| Component | Minimum Specification | Recommended Production Target | Interconnect Protocol |
| :--- | :--- | :--- | :--- |
| **MikroTik Router** | RouterOS v7.14+ (ARM64 / TILE / x86_64) | MikroTik CCR2004-16G-2S+ or RB5009UG+S+IN | RouterOS REST API (TCP 80/443) |
| **RADIUS Engine** | FreeRADIUS 3.2.x with `rlm_sql` | FreeRADIUS 3.2.x Docker / Bare-metal | RADIUS Auth (UDP 1812), Acct (UDP 1813), CoA (UDP 3799) |
| **PPPoE Client** | Standard RFC 2516 PPPoE Client | MikroTik hAP ax2 CPE or Linux `pppd` or Windows Dial-up | Point-to-Point Protocol over Ethernet (PPPoE) |
| **Database Server** | PostgreSQL 16 Alpine | High-Availability PostgreSQL 16 with WAL streaming | Native Postgres Wire (TCP 5432) |
| **Traffic Tester** | Linux Client with `iperf3` | Gigabit Ethernet iperf3 Client & Multi-threaded Server | TCP/UDP Throughput Testing |

---

## 3. Step-by-Step Hardware Validation Protocol

### Phase 1: Environment Readiness & Pre-Flight Checks
1. Confirm MikroTik RouterOS device is booted with RouterOS v7.12+.
2. Confirm RouterOS REST API / www service is enabled:
   ```routeros
   /ip service enable www
   /ip service set www port=80 address=192.168.0.0/16,10.0.0.0/8
   ```
3. Configure RADIUS client on MikroTik:
   ```routeros
   /radius add service=ppp address=<FREERADIUS_IP> secret="radius_secret_123" authentication-port=1812 accounting-port=1813 timeout=3s
   /radius incoming set accept=yes port=3799
   /interface pppoe-server server add service-name=ISP-PPPOE interface=ether2 one-session-per-host=yes default-profile=default authentication=pap,chap
   /ppp profile set default use-radius=yes only-one=yes
   ```
4. Verify FreeRADIUS `clients.conf` contains the MikroTik IP and shared secret.

### Phase 2: Real MikroTik API Connectivity & Discovery
- **Action:** In CRM `/routers`, register the physical router:
  - IP Address: `<MIKROTIK_MANAGEMENT_IP>`
  - API Port: `80` (or `443` for SSL)
  - Username: `admin` (or dedicated `ispcrm_api` user)
  - Password: `<ROUTER_PASSWORD>`
- **Execute Probe:** Click **"Test Connection"** (`POST /routers/:id/test-connection`).
- **Validation Criteria:**
  - `success` MUST be `true`.
  - Identity, RouterOS version, CPU load, and round-trip latency (e.g. 5–15ms) must reflect the physical device.
  - If unreachable or port closed, the CRM MUST display `ERROR`/`OFFLINE` and never report a false "Connected" status.

### Phase 3: FreeRADIUS + MikroTik Integration
- **Action:** Verify FreeRADIUS daemon connectivity against PostgreSQL `radcheck`, `radreply`, and `radacct` tables.
- **Verification:**
  1. `radtest <username> <password> <FREERADIUS_IP>:1812 0 <RADIUS_SECRET>`
  2. Verify Access-Accept on correct credentials.
  3. Verify Access-Reject on incorrect credentials.
  4. Verify dictionary contains `Mikrotik-Rate-Limit` attribute.

### Phase 4: Customer Provisioning & Real PPPoE Connection
- **Action:** Complete customer creation through CRM UI:
  1. Navigate to `/plans` → Create "SpeedFiber 50M" (`50M/50M` or `25M/50M`, ₹499 + GST).
  2. Navigate to `/customers` → Create Customer `testcustomer001`.
  3. Provision PPPoE username `testcustomer001` and strong password.
  4. Create Subscription on the 50M plan.
  5. Settle Invoice via `/payments` (record UPI/Cash settlement).
  6. Confirm Subscription transitions to `ACTIVE`.
- **PPPoE Client Connect:** Initiate PPPoE connection from CPE or Windows/Linux client connected to the MikroTik PPPoE server port (`ether2`).
- **Validation Criteria:**
  1. PPPoE discovery completes (PADI, PADO, PADR, PADS).
  2. RouterOS sends RADIUS Access-Request to FreeRADIUS.
  3. FreeRADIUS queries PostgreSQL `radcheck` and returns Access-Accept with `Mikrotik-Rate-Limit = 25M/50M`.
  4. Client receives an IP address from the MikroTik IP pool.
  5. RouterOS creates a dynamic queue:
     ```routeros
     /queue simple print where name~"testcustomer001"
     ```
     Showing `max-limit=25M/50M`.
  6. Accounting start packet is written to `radacct`.

### Phase 5: Controlled Bandwidth Enforcement Test
- **Action:** Run multi-stream TCP throughput test using `iperf3`:
  ```bash
  iperf3 -c <IPERF3_SERVER_IP> -t 15 -P 4
  iperf3 -c <IPERF3_SERVER_IP> -t 15 -P 4 -R
  ```
- **Validation Criteria:**
  - Measured upload throughput should strictly clamp to ~25 Mbps (±10% TCP/Ethernet framing overhead).
  - Measured download throughput should strictly clamp to ~50 Mbps (±10% overhead).
  - RouterOS simple queue counters must increment in real time.

### Phase 6: Live Plan Upgrade & RADIUS Change of Authorization (CoA)
- **Action:** In CRM UI `/subscriptions`:
  1. Upgrade `testcustomer001` to "SpeedFiber 100M" (`50M/100M`).
  2. The CRM worker triggers a RADIUS CoA request to the physical MikroTik NAS on UDP port 3799.
- **Validation Criteria:**
  1. MikroTik receives RFC 3576 CoA packet with new `Mikrotik-Rate-Limit = 50M/100M`.
  2. MikroTik returns CoA-ACK.
  3. The active simple queue on the MikroTik updates dynamically to `50M/100M` without tearing down the PPPoE session.
  4. Subsequent `iperf3` test demonstrates immediate bandwidth expansion up to ~100 Mbps.

### Phase 7: Customer Suspension & Real Disconnect
- **Action:** In CRM UI `/customers/[id]`, click **"Suspend Customer"**.
- **Validation Criteria:**
  1. PostgreSQL marks customer status `SUSPENDED`.
  2. FreeRADIUS credentials in `radcheck` are prefixed/disabled.
  3. CRM worker sends RFC 3576 Disconnect-Request (PoD) to MikroTik UDP 3799.
  4. MikroTik acknowledges Disconnect-ACK and terminates the PPPoE session.
  5. The client interface drops to disconnected state.
  6. Any reconnection attempt from the client yields `Access-Reject`.

### Phase 8: Customer Reactivation
- **Action:** In CRM UI `/customers/[id]`, click **"Reactivate Customer"**.
- **Validation Criteria:**
  1. Customer status returns to `ACTIVE`.
  2. Valid credentials and rate-limits are restored to `radcheck` and `radreply`.
  3. Client reconnects successfully via PPPoE.
  4. Access-Accept is issued and traffic flows at the assigned plan rate.

---

## 4. Failure & Fault Injection Suite (Phase 11)

| # | Fault Scenario | Injection Method | Expected System Behavior |
| :--- | :--- | :--- | :--- |
| 1 | **MikroTik Offline** | Disconnect router management cable | CRM reports `OFFLINE`/timeout after 4s; UI shows descriptive error; no server crash. |
| 2 | **Wrong Router Password** | Alter password in router entity | Connection test returns 401 Unauthorized; credentials masked; error logged. |
| 3 | **FreeRADIUS Offline** | Stop FreeRADIUS service | PPPoE server times out or falls back; CRM shows authentication alarms. |
| 4 | **PostgreSQL Constraint** | Insert duplicate username or slug | API returns HTTP 409 Conflict with structured validation message. |
| 5 | **Redis Connection Loss** | Terminate Redis daemon | BullMQ queues pause; health probe returns 503; operations queue gracefully. |
| 6 | **Wrong PPPoE Password** | Client attempts invalid secret | FreeRADIUS returns Access-Reject; logged in `radacct` as auth failure. |
| 7 | **Suspended Customer Login**| Suspended user attempts PPPoE | Strict Access-Reject; zero session time granted. |
| 8 | **Subscription Expiry** | Scanner marks past-due sub expired | Subscription becomes EXPIRED; automated PoD disconnect dispatched. |
| 9 | **Cancelled Invoice Pay** | Submit payment on cancelled bill | API rejects with HTTP 400 Bad Request; financial balance preserved. |
| 10| **Duplicate Payment Webhook**| Re-post same payment payload | Idempotency key triggers HTTP 200 with `isDuplicate: true`; no double-credit. |
| 11| **CoA Timeout to Router** | Block UDP 3799 | BullMQ worker handles timeout asynchronously without stalling user UI response. |
| 12| **Router API Timeout** | Route to unroutable IP (10.254.254.99) | Probe times out cleanly; password sanitized; safe UI error message displayed. |

---

## 5. Certification Acceptance Checklist

- [ ] All 12 failure test cases pass without application panic or unhandled exceptions.
- [ ] No fake success states exist in the codebase.
- [ ] Password hashes and secrets are strictly stripped from all REST and GraphQL responses.
- [ ] Multi-tenant isolation is cryptographically and logically impenetrable across organizations.
- [ ] Complete hardware validation report published to `docs/REAL-HARDWARE-VALIDATION-REPORT.md`.
