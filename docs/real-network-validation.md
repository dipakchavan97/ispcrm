# Real Network & Hardware Validation Report

**Date:** September 12, 2026  
**Lead Engineer:** Antigravity Principal QA & Systems Engineer  
**Scope:** Physical Hardware vs Emulated / Containerized AAA Validation

---

## 1. Test Environment Specification

| Component | Target Architecture / Specification | Active Test Environment Status |
| :--- | :--- | :--- |
| **ISP CRM Platform** | Next.js 14 + NestJS 10 + BullMQ Worker | Running in Docker (`ispcrm-api`, `ispcrm-web`, `ispcrm-worker`) |
| **Relational Database** | PostgreSQL 16 Alpine (`rlm_sql`) | Running in Docker (`ispcrm-postgres`) on port 5432 |
| **Cache & Queue Broker**| Redis 7 Alpine | Running in Docker (`ispcrm-redis`) on port 6379 |
| **FreeRADIUS Engine** | FreeRADIUS 3.2.3 (Debian/Alpine Docker) | Running in Docker (`ispcrm-freeradius`) on ports 1812, 1813, 3799 |
| **MikroTik RouterOS** | RouterOS v7.14+ (x86_64 Cloud Hosted Router / RB5009) | **Simulated / Mock Client Mode** in local developer sandbox (`USE_MOCK_MIKROTIK=true`) |
| **PPPoE Client** | Linux `pppd` / Windows Dial-up / ONT | Automated test harness client simulating PPPoE authentication via FreeRADIUS `radcheck` |

---

## 2. Hardware Availability Disclosure

> [!NOTE]
> **Physical Hardware Presence Status:**
> In this local development and automated CI environment, **no physical MikroTik hardware device (RouterBOARD/Cloud Router Switch) is physically attached via ethernet or routable WAN IP**.
> 
> Per Section 38 directives:
> *"DO NOT claim physical router validation if the router was not actually reachable."*
>
> Therefore, physical RouterOS hardware verification has **NOT** been performed against physical silicon. Instead, validation was executed using:
> 1. **Real FreeRADIUS 3.x Docker container** querying the live PostgreSQL database.
> 2. **Real PostgreSQL `radcheck`, `radreply`, and `radacct` tables** receiving customer credentials, `Mikrotik-Rate-Limit` attributes, and active accounting sessions.
> 3. **The NestJS `RouterOsRestClient` & `MockMikrotikClient` abstraction** which executes full RouterOS v7 REST API payload serialization, timeouts, error traps, and credentials encryption.

---

## 3. End-to-End Functional Test Matrix

| # | Test Phase | Verification Mechanism | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Customer Provisioning** | API `POST /customers` → DB `tx.customer` + `radcheck` | **PASS** | Cleartext-Password stored in `radcheck` table |
| 2 | **Plan Bandwidth Conversion** | `generateMikrotikRateLimit(plan)` → `radreply` | **PASS** | `Mikrotik-Rate-Limit := 50M/100M` correctly injected |
| 3 | **RADIUS Authentication** | Query `radcheck` for subscriber username | **PASS** | Matches Cleartext-Password with tenant scope |
| 4 | **Accounting Accounting Start/Stop**| Query `radacct` table | **PASS** | Active sessions rendered in Network Command Center |
| 5 | **Plan Upgrade (CoA)** | API `POST /subscriptions/:id/upgrade` → BullMQ | **PASS** | Queue job processes new `Mikrotik-Rate-Limit` attribute |
| 6 | **Subscriber Suspension** | Subscription expiry or manual suspend → PoD queue | **PASS** | Password changed to `SUSPENDED_*`, Disconnect queued |
| 7 | **Subscriber Reactivation** | Payment settlement → Subscription ACTIVE | **PASS** | `radcheck` restored to subscriber password |

---

## 4. Known Hardware Differences & Limitations

1. **RouterOS v6 vs v7:**
   - The production `RouterOsRestClient` uses the RouterOS v7 REST API (`/rest/system/resource`, `/rest/interface`, etc.). Older hardware running RouterOS v6 requires either upgrading to RouterOS v7 or enabling the RouterOS binary API (TCP 8728).
2. **Firewall / NAT Configuration:**
   - In production deployments where the MikroTik router is behind a NAT or firewall, incoming UDP 3799 (CoA/PoD) must be explicitly forwarded or an IPsec/WireGuard tunnel must be established between the ISP CRM worker and the MikroTik management IP.
3. **PPPoE Service Binding:**
   - Physical ONT connectivity requires properly mapped VLAN IDs on the MikroTik trunk port (e.g., VLAN 100 on SFP+ 1).

---

## 5. Certification for Production On-Premises Deployment

When deploying to production with a physical MikroTik RouterOS device:
1. Set `USE_MOCK_MIKROTIK=false` in `.env`.
2. Follow the step-by-step commands documented in [mikrotik-radius-setup.md](file:///f:/project/ISPCRM/docs/mikrotik-radius-setup.md).
3. Verify connection via the **"Test Connection"** button in the CRM `/routers` UI.
