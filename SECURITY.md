# Security Policy & Audit Assessment

## 1. Executive Summary

This document presents the official Security Policy and Comprehensive Security Audit Report for the **ISP CRM, Billing & Bandwidth Management Platform** (MVP).

The platform serves multi-tenant Internet Service Providers (ISPs), processing sensitive subscriber records, physical MikroTik network infrastructure credentials, FreeRADIUS AAA authentication, and Indian GST financial transactions. A zero-trust, defense-in-depth posture is applied across all micro-services, APIs, databases, and network adapters.

### Audit Scope & Verification Results
- **Target Surfaces**: REST API (NestJS), Web Dashboard (Next.js 14), Database (PostgreSQL 16 / Prisma), FreeRADIUS 3.x, Background Worker (BullMQ), and Redis 7.
- **Automated Test Results**:
  - `scripts/security-audit-test.mjs`: **20/20 Passed (100%)**
  - `scripts/qa-full-e2e-test.mjs`: **44/44 Passed (100%)**
  - `scripts/test-all-docker-features.mjs`: **48/48 Passed (100%)**
- **Vulnerabilities Remediated**: All critical and high-severity security findings identified during the audit were remediated, compiled, and verified under real Docker runtime conditions.

---

## 2. Security Architecture & Threat Model

```
       [ Malicious Actor / Untrusted Web ]
                       │
                       ▼
       ┌───────────────────────────────┐
       │     Strict CORS Filtering     │  (Rejects unauthorized Origins)
       └───────────────┬───────────────┘
                       │
                       ▼
       ┌───────────────────────────────┐
       │   OWASP Security Headers      │  (X-Content-Type-Options, X-Frame-Options DENY,
       │   & Prototype Pollution Guard │   HSTS, blocks __proto__/constructor injection)
       └───────────────┬───────────────┘
                       │
                       ▼
       ┌───────────────────────────────┐
       │    RateLimitGuard (Redis)     │  (Throttles brute force & spam before CPU/DB work)
       └───────────────┬───────────────┘
                       │
                       ▼
       ┌───────────────────────────────┐
       │   JwtAuthGuard (Tenant Enforce)  (Validates Bearer token signature, verifies DB status,
       │                               │   attaches DB-verified organizationId & role)
       └───────────────┬───────────────┘
                       │
                       ▼
       ┌───────────────────────────────┐
       │     RolesGuard (RBAC Matrix)  │  (Enforces role permissions: ISP_OWNER, ISP_ADMIN,
       │                               │   BILLING, SUPPORT, TECHNICIAN, READ_ONLY)
       └───────────────┬───────────────┘
                       │
                       ▼
       ┌───────────────────────────────┐
       │   Tenant-Isolated Services    │  (Every SQL query strictly filtered by organizationId)
       └───────────────┬───────────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼                               ▼
┌──────────────┐              ┌────────────────┐
│  PostgreSQL  │              │  MikroTik BNG  │
│ (Parameter-  │              │ (AES-256-GCM   │
│  ized SQL)   │              │  Encrypted)    │
└──────────────┘              └────────────────┘
```

---

## 3. Comprehensive Audit of 19 Focus Areas

### 1. Insecure Direct Object References (IDOR)
- **Mechanism**: Every database lookup across `CustomersService`, `PlansService`, `SubscriptionsService`, `InvoicesService`, `PaymentsService`, and `MikrotikService` explicitly enforces `where: { id, organizationId }`.
- **Validation**: Path parameter IDs (`:id`) are never resolved in isolation. If Tenant A requests `GET /api/customers/:tenantB_id`, the database query returns `null`, and the service raises a `404 Not Found` exception, disclosing zero metadata.
- **Audit Verification**: Verified in Phase 2 of `qa-full-e2e-test.mjs` with cross-tenant probe tests.

### 2. Multi-Tenant Isolation
- **Context Derivation**: `organizationId` is never trusted from request bodies, query strings, or client headers. It is strictly injected by `JwtAuthGuard` into `req.user` directly from an internal database verification of the authenticated administrator.
- **Data Segregation**: Compound unique indexes (`[organizationId, customerCode]`, `[organizationId, invoiceNumber]`, `[organizationId, host]`) prevent namespace collisions between distinct ISP tenants.
- **Audit Verification**: Verified that customer, plan, and invoice list endpoints return strictly tenant-scoped collections.

### 3. Authentication
- **Flow**: Two-factor token architecture (`accessToken` + `refreshToken`).
- **State Enforcement**: On every authenticated request, `JwtAuthGuard` checks `user.isActive` and `user.organization.isActive`. If a tenant or user is deactivated, all active sessions are instantly revoked.
- **Audit Logging**: Every successful authentication and logout emits an immutable `AuditLog` entry.

### 4. Role-Based Access Control (RBAC) & Authorization
- **Role Hierarchy**:
  - `ISP_OWNER`: Full tenant administrative authority.
  - `ISP_ADMIN`: Full administrative operations except deleting the organization or creating secondary owners.
  - `BILLING`: Invoicing, payment collection, offline settlements, and refunds. Restricted from router credentials.
  - `TECHNICIAN`: Read-only NOC telemetry, ping/test-connection, and subscriber diagnostics. Restricted from financial mutations.
  - `SUPPORT`: Subscriber status tracking, ticket handling, and lead onboarding.
  - `READ_ONLY`: Passive dashboard inspection.
- **Guard Enforcement**: `RolesGuard` executes globally across all endpoints decorated with `@Roles(...)`.

### 5. JSON Web Tokens (JWT)
- **Signature Algorithm**: HMAC SHA-256 (`HS256`).
- **Expiration Policy**: Access tokens expire in 1 hour (`1h`).
- **Payload Sanitization**: JWT claims contain only non-sensitive identity metadata (`sub`, `organizationId`, `email`, `role`, `orgSlug`). Passwords, encryption keys, and secrets are excluded.

### 6. Refresh Tokens & Rotation
- **Storage Hashing**: Raw refresh tokens are never persisted. They are hashed using `bcrypt` (10 rounds) and stored in `admin_users.refreshTokenHash`.
- **Token Rotation**: Every refresh request (`POST /api/auth/refresh`) invalidates the consumed refresh token, generates a new token pair, and overwrites `refreshTokenHash`.
- **Revocation**: Calling `POST /api/auth/logout` sets `refreshTokenHash = null`, terminating the session family.

### 7. Password Handling
- **Hashing**: Staff passwords and ISP owner credentials are encrypted using `bcryptjs` with salt rounds = 10.
- **Zero Plaintext Storage**: The database stores only `passwordHash`.
- **Response Scrubbing**: Prisma queries for `adminUser` explicitly exclude `passwordHash` and `refreshTokenHash` via field projection (`select: { id: true, name: true, email: true, ... }`).
- **Customer PPPoE Passwords**: Stored as operational PPPoE secrets for FreeRADIUS AAA, but sanitized from general customer list views (`formatCustomer` strips credentials).

### 8. SQL Injection
- **Engine**: PostgreSQL 16 accessed via Prisma ORM.
- **Parameterization**: 100% of queries use typed Prisma operations or tagged template literals (`prisma.$queryRaw\`SELECT 1\``).
- **Audit Verification**: Zero string-concatenated SQL queries exist in the codebase. Static analysis and manual grep verified zero instances of `$queryRawUnsafe` or `$executeRawUnsafe`.

### 9. Cross-Site Scripting (XSS)
- **Frontend Architecture**: Next.js 14 / React with automatic context-aware JSX entity encoding.
- **Audit Findings**: Zero usage of `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, or `eval` across the entire `apps/web` codebase.
- **URL Handling**: Dynamic links strictly use relative routing parameterized with validated UUIDs (`href={`/customers/${id}`}`).
- **Defensive Headers**: `X-XSS-Protection: 1; mode=block` and `X-Content-Type-Options: nosniff` are set on all responses.

### 10. Cross-Site Request Forgery (CSRF)
- **Bearer Token Architecture**: The REST API utilizes `Authorization: Bearer <JWT>` headers instead of ambient browser cookies.
- **Inherent CSRF Immunity**: Web browsers do not attach custom `Authorization` headers cross-origin without explicit CORS preflight consent.
- **Preflight Enforcement**: Browsers sending cross-origin requests must pass preflight `OPTIONS` checks, which reject unauthorized origins.

### 11. Rate Limiting & Denial-of-Service (DoS)
- **Engine**: `RateLimitGuard` utilizing Redis 7 (`INCR` + `EXPIRE`), with atomic in-memory sliding-window fallback during Redis maintenance.
- **Granular Limits**:
  - `POST /api/auth/login`: 30 attempts / 60 seconds per IP + target email.
  - `POST /api/auth/register-org`: 15 attempts / 3600 seconds per IP.
  - `POST /api/auth/refresh`: 60 requests / 60 seconds per IP.
  - `POST /api/payments/webhook`: 60 requests / 60 seconds per IP.
  - Global Default: 300 requests / 60 seconds per IP.
- **HTTP 429 Compliance**: Exceeded quotas return standard `429 Too Many Requests` with `Retry-After`, `X-RateLimit-Limit`, and `X-RateLimit-Remaining` headers.

### 12. Cross-Origin Resource Sharing (CORS)
- **Remediation Applied**: Removed permissive wildcard origin reflection (`origin: true`).
- **Strict Allowed Origins**: Strictly validates against `CORS_ALLOWED_ORIGINS` (defaulting to configured frontend `http://localhost:3000`).
- **Header & Method Restrictions**: Restricts allowed methods (`GET, POST, PUT, PATCH, DELETE, OPTIONS`) and allowed headers (`Content-Type, Authorization, X-Requested-With, X-Idempotency-Key, X-Webhook-Signature`).

### 13. API Validation & Prototype Pollution
- **Global Validation**: NestJS `ValidationPipe` with `whitelist: true`, `transform: true`, and `forbidNonWhitelisted: true`.
- **Prototype Pollution Shield**: `SecurityHeadersMiddleware` recursively inspects incoming request bodies and query parameters. Payloads attempting to hijack `__proto__`, `constructor`, or `prototype` are rejected with `HTTP 400 Bad Request`.
- **Validation Schemas**: All core domain models backed by Zod schemas in `@isp-crm/shared`.

### 14. MikroTik Router Credentials
- **Encryption at Rest**: AES-256-GCM authenticated encryption (`iv:authTag:ciphertext`).
- **Unique IV**: Every encryption generates a cryptographically random 16-byte initialization vector (`crypto.randomBytes(16)`).
- **Ephemeral In-Memory Decryption**: Credentials are decrypted only in-memory during transient RouterOS API or SSH dispatch.
- **Response Sanitization**: `sanitizeRouter()` and `sanitizeRouters()` delete `encryptedCredential`, `password`, and `apiPassword` before JSON serialization.
- **Log Masking**: `sanitizeMessage()` scrubs credentials, passwords, and authorization tokens from error traces and logger streams.

### 15. FreeRADIUS AAA Secrets
- **NAS Client Sync**: Routers synchronized dynamically with FreeRADIUS `nas` table over encrypted Docker network.
- **Shared Secrets**: Dynamic NAS entries assign per-router RADIUS secrets.
- **Network Boundaries**: FreeRADIUS ports (1812/UDP, 1813/UDP, 3799/UDP) are isolated within the internal bridge network or restricted to verified NAS IP subnets.

### 16. Environment Variables & Secret Hygiene
- **Secret Separation**: `.env.example` contains non-secret development defaults. Production deployments require explicit environment variable injection.
- **Production Startup Checks**:
  - `JWT_SECRET`: Startup logs a high-severity alert if default key or <32 characters entropy is detected.
  - `ROUTER_ENCRYPTION_KEY`: Enforces 256-bit entropy for AES-256-GCM.
- **No Hardcoded Secrets**: Secrets are loaded via `@nestjs/config` and `process.env`.

### 17. Payment Webhooks
- **Endpoint**: `POST /api/payments/webhook` (`@Public()`).
- **Cryptographic Signature Verification**: Validates incoming `x-webhook-signature` or payload signature against `PAYMENT_WEBHOOK_SECRET` using HMAC SHA-256 with timing-safe comparison (`crypto.timingSafeEqual`) to prevent timing attacks.
- **Replay Protection**: Webhook deliveries are keyed by `gatewayPaymentId` and settled inside atomic database transactions.

### 18. Payment Idempotency & Financial Safety
- **Atomic Transactions**: Payment settlement executes within `prisma.$transaction`.
- **Tri-State Settle Check**: Checks `idempotencyKey`, `gatewayPaymentId`, and `transactionRef`.
- **Double-Credit Prevention**: If a payment with the same idempotency key or gateway transaction ID is re-submitted, the system returns `isDuplicate: true, isSuccess: true` with the existing receipt, leaving invoice balance untouched.
- **Audit Verification**: Verified in Phase 5 of `qa-full-e2e-test.mjs` and Test Group 5 of `security-audit-test.mjs`.

### 19. Audit Logging & Non-Repudiation
- **Scope**: All security-critical events are captured in `audit_logs`:
  - `LOGIN` & `LOGOUT`: Admin user authentication tracking.
  - `CREATE`, `UPDATE`, `DELETE`: Router fleet modifications and staff management.
  - `STATUS_CHANGE`: Subscriber suspensions and activations.
  - `COLLECT_PAYMENT`: Financial settlements and invoice receipts.
  - `COA_DISCONNECT`: Network session terminations.
- **Attributes Captured**: `organizationId`, `adminUserId`, `action`, `entityType`, `entityId`, `details` (JSON snapshot), and `createdAt`.

---

## 4. Summary of Vulnerabilities Remediated

| Vulnerability | Severity | Status | Remediation Details |
|---|---|---|---|
| **Permissive CORS Reflection** | High | Resolved | Replaced wildcard `origin: true` with strict origin whitelist check (`CORS_ALLOWED_ORIGINS`). |
| **Missing Rate Limiting on Auth** | High | Resolved | Implemented `RateLimitGuard` with Redis store and sliding-window fallback, throttling brute-force attempts with HTTP 429. |
| **Prototype Pollution Exposure** | Medium | Resolved | Implemented `SecurityHeadersMiddleware` to detect and block `__proto__` and constructor hijacking attempts. |
| **Missing Payment Webhook Endpoint** | Medium | Resolved | Added `POST /api/payments/webhook` with HMAC SHA-256 timing-safe signature verification and idempotent settlement. |
| **Missing Audit Trail on Infrastructure** | Medium | Resolved | Added audit logging for router creation, updates, deletions, admin staff changes, and user logins. |
| **Insecure Secrets Fallback** | Medium | Resolved | Added production startup sanity checks verifying 256-bit entropy on `JWT_SECRET` and `ROUTER_ENCRYPTION_KEY`. |

---

## 5. Security Testing Verification

To re-run the full security audit and verification test suites:

```bash
# 1. Run Dedicated Security & Defensive Controls Suite (20 tests)
node scripts/security-audit-test.mjs

# 2. Run Comprehensive QA End-to-End Test Suite (44 tests)
node scripts/qa-full-e2e-test.mjs

# 3. Run Full Docker Feature & Infrastructure Suite (48 tests)
node scripts/test-all-docker-features.mjs
```

All test suites verify 100% pass rates in running Docker environments.

---

## 6. Vulnerability Reporting Policy

We welcome security research and responsible vulnerability disclosure. If you discover a potential security vulnerability in this project, please report it privately:

- **Email**: `security@ispcrm.local` (or your organization's security contact)
- **Response SLA**: Within 24 hours of report receipt.
- **Patch Window**: Critical vulnerabilities addressed within 72 hours.
- **Do Not Disclose**: Please do not open public GitHub issues or disclose vulnerability details publicly until an official advisory and patch are released.
