# ISP CRM Current State Audit & System Architecture Assessment

**Date:** September 12, 2026  
**Auditor:** Principal Software & Systems Engineer  
**Repository:** `isp-crm` (Multi-tenant ISP Operations, Billing & Network Automation Platform)

---

## 1. What Already Works

1. **Authentication & Multi-Tenant Security (`apps/api/src/modules/auth`):**
   - JWT access tokens (15m expiry) and refresh tokens (7d expiry) with cryptographically secure rotation and database tracking (`RefreshToken` entity).
   - Tenant isolation enforced on all authenticated endpoints via `TenantGuard`, resolving `organizationId` from authenticated JWT claims (`req.user.organizationId`).
   - Secure password hashing using `bcryptjs` (salt rounds 10) with zero credential leaks in API responses or logs.
   - Dynamic role-based access control (`SUPER_ADMIN`, `ADMIN`, `STAFF`).
   - Strict rate limiting via Redis (`RateLimitGuard` at 120 req/min for standard endpoints, 10 req/min for auth).
   - Helmet security headers and prototype pollution sanitation middleware on all incoming requests.

2. **Customer Lifecycle Management (`apps/api/src/modules/customers`):**
   - Multi-tenant CRUD operations with organization scoping.
   - Comprehensive customer fields: Name, Phone, Email, National ID, Address, City, Pincode, Status (`PENDING`, `ACTIVE`, `SUSPENDED`, `EXPIRED`, `TERMINATED`).
   - Secure provisioning of PPPoE credentials: `pppoePassword` is encrypted at rest using AES-256-GCM via `CryptoService` and redacted from list views and serialized DTOs.
   - Automatic FreeRADIUS integration: Creating a customer provisions `radcheck` (Cleartext-Password) and `radreply` (Framed-IP-Address / Mikrotik-Rate-Limit) records in PostgreSQL.
   - Suspension and reactivation triggers synchronize both the internal database state and RADIUS check attributes (`Auth-Type := Reject` on suspension).

3. **Plans & Bandwidth Profiles (`apps/api/src/modules/plans`):**
   - Plan creation and management with attributes: Download/Upload speeds (in Mbps/Kbps), FUP limits, price, billing cycle, validity days, and active status.
   - Conversion to MikroTik RouterOS and FreeRADIUS `Mikrotik-Rate-Limit` attribute format (e.g. `10M/20M 0/0 0/0 0/0 8 5M/10M`).

4. **Subscriptions & State Transitions (`apps/api/src/modules/subscriptions`):**
   - Formal finite state machine: `PENDING` -> `ACTIVE` -> `GRACE` -> `SUSPENDED` -> `EXPIRED` -> `CANCELLED`.
   - Renewal, upgrade, downgrade, extend, suspend, and reactivate workflows.
   - Atomic database transactions preventing race conditions during status updates.

5. **Invoices & Billing (`apps/api/src/modules/invoices`):**
   - Invoice generation linked to subscriptions and customers.
   - Exact integer/decimal monetary precision (avoiding IEEE 754 floating point issues).
   - Invoice statuses: `DRAFT`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `CANCELLED`.
   - Comprehensive itemization with subtotal, tax, discounts, and balance calculations.

6. **Payments & Webhooks (`apps/api/src/modules/payments`):**
   - `MockPaymentProvider` for automated CI/local sandbox testing.
   - Idempotent payment recording with unique transaction IDs and database locking.
   - HMAC SHA-256 webhook signature verification (`POST /api/payments/webhook`).
   - Payment settlement automatically transitions invoices to `PAID` and triggers subscription activation/renewal.

7. **MikroTik RouterOS Integration (`apps/api/src/modules/mikrotik`):**
   - Router entity with AES-256-GCM encrypted passwords stored in the database.
   - `RouterOsRestClient` supporting RouterOS v7 REST API for resource queries, interface metrics, active PPP sessions, and identity.
   - `MockMikrotikClient` active when `USE_MOCK_MIKROTIK=true` or when router IP is `127.0.0.1` / `mock`.
   - Safe timeouts (5000ms), structured error formatting, and credential redaction across all responses.

8. **FreeRADIUS PostgreSQL Backend (`infrastructure/docker/freeradius`):**
   - FreeRADIUS 3.2+ running in Docker with `rlm_sql` linked to PostgreSQL `radius` tables: `radcheck`, `radreply`, `radusergroup`, `radgroupcheck`, `radgroupreply`, `radacct`, `nas`.
   - Standard ports: 1812/udp (auth), 1813/udp (acct), 3799/udp (CoA/PoD).

9. **Asynchronous Background Processing (`apps/worker`, BullMQ & Redis):**
   - `radius-coa.processor.ts`: Asynchronously handles CoA/Disconnect packets for plan changes, suspensions, and reactivations without blocking HTTP request threads.
   - `subscription-expiry.processor.ts`: Cron worker evaluating expiring subscriptions, transitioning them to `EXPIRED`/`SUSPENDED` and enqueueing network disconnect jobs.

---

## 2. What is Partially Implemented

1. **Frontend Navigation & App Shell:**
   - Top Header bar displays static user/org labels and lacks dynamic profile retrieval (`/auth/me`) and Logout action.
   - Navigation sidebar lacks direct links to `/network`, `/reports`, `/settings`.
2. **Unified Add Customer Workflow:**
   - Backend `POST /api/customers` supports creating a customer, assigning a plan, and setting PPPoE credentials in a single call. However, the frontend Add Customer modal was fragmented and did not allow choosing the target router in the initial step.
3. **Tickets / Helpdesk System:**
   - The frontend `/tickets` UI was relying on browser `localStorage` (`ispcrm_operator_tickets`) because the database and NestJS backend lacked a persistent `Ticket` and `TicketComment` entity.
4. **Customer 360 View (`/customers/[id]`):**
   - Customer detail page renders info, subscriptions, and invoices, but lacks the unified Tickets section and real-time active RADIUS session info.

---

## 3. What is Missing

1. **Dedicated Login Screen (`/login`):**
   - Missing standalone login page with email, password, show/hide password, loading state, error display, and redirect handling.
   - Route protection was previously relying on an auto-login token in `apps/web/src/lib/api.ts`.
2. **Network Command Center (`/network`):**
   - Missing dedicated page displaying the MikroTik router fleet, status, CPU/Memory metrics, and active PPPoE subscriber sessions with disconnect/kick capability.
3. **Dedicated Settings & Reports Screens:**
   - Routes `/settings` and `/reports` were returning 404 in the Next.js frontend.
4. **Database & API for Tickets:**
   - Missing `Ticket` and `TicketComment` models in `packages/database/prisma/schema.prisma` and corresponding NestJS module `apps/api/src/modules/tickets`.

---

## 4. What is Mocked

1. **MikroTik Communication in Non-Hardware Environments:**
   - When no physical RouterOS device is reachable or `USE_MOCK_MIKROTIK=true`, `MockMikrotikClient` provides deterministic responses for testing without failing connection tests.
2. **Payment Processing:**
   - `MockPaymentProvider` simulates bank authorization and webhook delivery. Real gateways (Razorpay, Stripe) have architectural stubs but require live credentials in production.

---

## 5. What is Not Connected End-to-End

1. **Frontend Tickets to API:**
   - Previously stored in `localStorage`; needs full API persistence with multi-tenant isolation.
2. **Network Command Center to Real FreeRADIUS `radacct`:**
   - Active sessions need to query `radacct` (or RouterOS `/ppp/active`) through a centralized backend endpoint.

---

## 6. Frontend/Backend Mismatches

1. **Authentication Token Handling:**
   - `apps/web/src/lib/api.ts` had an automatic fallback `ensureAuthToken()` creating a token for `admin@speednet.in` instead of directing unauthenticated users to `/login`.
2. **Ticket Types:**
   - Frontend had custom TypeScript definitions for tickets not backed by Prisma types.

---

## 7. Database/API Mismatches

1. **Missing Ticket Entities:**
   - Database had `AuditLog`, `Customer`, `Plan`, `Subscription`, `Invoice`, `Payment`, `Router`, `RefreshToken`, but no `Ticket` entity.

---

## 8. RADIUS Gaps

1. **Accounting Session Cleanup:**
   - When MikroTik reboots unexpectedly, stale `radacct` entries without `acctstoptime` can remain until next session check. A periodic reconciliation job or query filter (`acctstoptime IS NULL AND acctstarttime > NOW() - INTERVAL '24 hours'`) is required.

---

## 9. MikroTik Gaps

1. **RouterOS v6 vs v7 API Support:**
   - The current client utilizes the RouterOS v7 REST API (`/rest/...`). Older RouterOS v6 devices require the proprietary RouterOS binary API (port 8728) or SSH. This must be documented in setup guides.

---

## 10. Testing Gaps

1. **Single 24-Step Master Acceptance Test:**
   - While `security-audit-test.mjs`, `qa-full-e2e-test.mjs`, and `test-all-docker-features.mjs` test individual subsystems, a single sequential script verifying the exact 24-step master workflow (`/scripts/full-isp-e2e-test.mjs`) is required.
