# REST API Specification & Architecture

## 1. Overview

The backend API is implemented as a **NestJS** application (`apps/api`), providing a RESTful JSON interface for the Web Admin (`apps/web`), customer self-service portals, and external webhook integrations.

- **Base URL**: `http://localhost:4000/api` (Local Dev)
- **API Documentation**: Interactive Swagger / OpenAPI 3.0 at `/api/docs`
- **Protocol**: HTTP/1.1 & HTTP/2 over TLS

---

## 2. Standard Request / Response Envelopes

### 2.1 Success Response Envelope
All standard successful responses return HTTP `200 OK` or `201 Created` with a structured envelope:

```json
{
  "success": true,
  "data": {
    "id": "c1f7a0e3-4d7a-4c28-98e3-0d9c4bf8a25c",
    "customerCode": "CUST-00102",
    "name": "Rajesh Kumar",
    "status": "ACTIVE"
  },
  "meta": {
    "timestamp": "2026-09-11T16:45:00.000Z",
    "requestId": "req_8f19da4c"
  }
}
```

### 2.2 Paginated Response Envelope
Endpoints that return lists accept query parameters `page` (default `1`) and `limit` (default `20`, max `100`):

```json
{
  "success": true,
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 20,
    "totalItems": 142,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPrevPage": false,
    "timestamp": "2026-09-11T16:45:00.000Z"
  }
}
```

### 2.3 Error Envelope
Standardized RFC 7807 compliant error format handled via global NestJS `HttpExceptionFilter`:

```json
{
  "success": false,
  "error": {
    "statusCode": 400,
    "error": "Bad Request",
    "message": "Validation failed",
    "details": [
      {
        "field": "pppoeUsername",
        "message": "pppoeUsername must not contain spaces or special characters"
      }
    ]
  },
  "meta": {
    "timestamp": "2026-09-11T16:45:00.000Z",
    "requestId": "req_8f19da4c",
    "path": "/api/customers"
  }
}
```

---

## 3. Endpoints Matrix

### 3.1 Health & Diagnostics

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/health` | Overall system liveness probe | Public |
| `GET` | `/api/health/db` | PostgreSQL connection pool readiness | Public |
| `GET` | `/api/health/redis` | Redis & BullMQ connection readiness | Public |

Example `/api/health` response:
```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" }
  },
  "details": {
    "uptime": 3600,
    "version": "1.0.0"
  }
}
```

---

### 3.2 Authentication & Multi-Tenancy (`/api/auth`)

Zero-Trust Multi-Tenancy Rule: `organizationId` is **NEVER** accepted from the frontend as the source of truth. It is strictly extracted from the authenticated user's JWT payload by backend guards and decorators (`@CurrentOrgId()`).

#### Standard RBAC Roles:
- **`ISP_OWNER`**: Organization creator, full administrative & financial control. Superset access across all operations.
- **`ISP_ADMIN`**: Tenant administrator, manages staff, plans, routers, and configurations.
- **`BILLING`**: Financial operations, plans, subscriptions, invoices, and payments.
- **`SUPPORT`**: Customer queries, ticket resolution, customer directory access.
- **`TECHNICIAN`**: Router setup, RADIUS troubleshooting, session disconnects.
- **`READ_ONLY`**: Audit, read-only analytics, and non-mutating customer views.

| Method | Path | Description | Access |
|---|---|---|---|
| `POST` | `/api/auth/register-org` | Self-serve ISP organization onboarding + initial `ISP_OWNER` creation -> Returns JWT access & refresh tokens | Public |
| `POST` | `/api/auth/login` | Email & password authentication -> Returns JWT access token + refresh token | Public |
| `POST` | `/api/auth/refresh` | Exchange refresh token for a freshly signed access token | Public |
| `GET` | `/api/auth/me` | Fetch active user profile, tenant organization context, and role | Authenticated |
| `POST` | `/api/auth/logout` | Invalidate active refresh token in database | Authenticated |

---

### 3.3 Staff User Management & RBAC (`/api/users`)

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/users` | List staff members within current tenant organization | `ISP_OWNER`, `ISP_ADMIN` |
| `POST` | `/api/users` | Provision staff user with assigned role (`ISP_ADMIN`, `BILLING`, `SUPPORT`, `TECHNICIAN`, `READ_ONLY`) | `ISP_OWNER`, `ISP_ADMIN` |
| `GET` | `/api/users/:id` | Get staff user profile (Tenant scoped) | `ISP_OWNER`, `ISP_ADMIN` |
| `PATCH` | `/api/users/:id` | Update staff status or role assignment | `ISP_OWNER`, `ISP_ADMIN` |

---

### 3.4 Organizations & Tenants (`/api/organizations`)

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/organizations/current` | Get current tenant profile and settings | All Roles |
| `PATCH` | `/api/organizations/current` | Update ISP branding, GSTIN, and company details | `ISP_OWNER`, `ISP_ADMIN` |

---

### 3.5 Customers & Subscribers (`/api/customers`)

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/customers` | List subscribers (Filter by status, search by name, phone, PPPoE username) | `ISP_OWNER`, `ISP_ADMIN`, `SUPPORT`, `TECHNICIAN`, `READ_ONLY` |
| `POST` | `/api/customers` | Create subscriber & provision PPPoE credentials in RADIUS | `ISP_OWNER`, `ISP_ADMIN` |
| `GET` | `/api/customers/:id` | Detailed subscriber profile (Tenant scoped) | `ISP_OWNER`, `ISP_ADMIN`, `SUPPORT`, `TECHNICIAN`, `READ_ONLY` |
| `POST` | `/api/customers/:id/suspend` | Immediate suspension: updates DB, flags `radcheck`, sends PoD/CoA disconnect | `ISP_OWNER`, `ISP_ADMIN` |
| `POST` | `/api/customers/:id/reactivate` | Reactivate suspended subscriber, restore plan speed | `ISP_OWNER`, `ISP_ADMIN` |
| `POST` | `/api/customers/:id/disconnect` | Force disconnect active PPPoE session via MikroTik CoA | `ISP_OWNER`, `ISP_ADMIN`, `TECHNICIAN` |

---

### 3.5 Internet Plans & Bandwidth Policies (`/api/plans`)

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/plans` | List active internet plans | Authenticated |
| `POST` | `/api/plans` | Create new internet package (speed, validity, price, burst limits) | OrgAdmin |
| `GET` | `/api/plans/:id` | Get internet plan details | Authenticated |
| `PATCH` | `/api/plans/:id` | Update pricing or speeds | OrgAdmin |
| `DELETE` | `/api/plans/:id` | Deactivate plan | OrgAdmin |
| `GET` | `/api/plans/bandwidth-policies` | List reusable MikroTik rate-limit policies | Engineer+ |

---

### 3.6 Subscriptions (`/api/subscriptions`)

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/subscriptions` | List subscriptions (filter by ACTIVE, EXPIRED, SUSPENDED) | Authenticated |
| `POST` | `/api/subscriptions` | Assign new plan to customer | Operator+ |
| `GET` | `/api/subscriptions/:id` | Subscription details | Authenticated |
| `POST` | `/api/subscriptions/:id/renew` | Extend subscription validity by plan duration | Operator+ |
| `POST` | `/api/subscriptions/:id/change-plan` | Upgrade or downgrade customer plan | Operator+ |

---

### 3.7 Invoices & Billing (`/api/invoices`)

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/invoices` | List invoices with GST breakdown | Authenticated |
| `POST` | `/api/invoices` | Generate single ad-hoc invoice | Operator+ |
| `POST` | `/api/invoices/generate-cycle` | Trigger recurring monthly invoice generation batch | OrgAdmin |
| `GET` | `/api/invoices/:id` | Fetch invoice details and line items | Authenticated |
| `GET` | `/api/invoices/:id/pdf` | Stream or download GST invoice PDF | Authenticated |
| `POST` | `/api/invoices/:id/cancel` | Cancel unpaid invoice | OrgAdmin |

---

### 3.8 Payments & Collections (`/api/payments`)

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/payments` | List payment transactions (Cash, UPI, Bank Transfer) | Authenticated |
| `POST` | `/api/payments` | Record payment against customer/invoice (auto-triggers reactivation if suspended) | Operator+ |
| `GET` | `/api/payments/:id` | Get receipt details | Authenticated |
| `GET` | `/api/payments/:id/receipt` | Download PDF payment receipt | Authenticated |

---

### 3.9 MikroTik Routers & Network Inventory (`/api/routers`)

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/routers` | List managed MikroTik BNG/NAS routers | Authenticated |
| `POST` | `/api/routers` | Register new router (IP, RADIUS secret, API credentials) | Engineer+ |
| `GET` | `/api/routers/:id` | Router status and specs | Authenticated |
| `PATCH` | `/api/routers/:id` | Update router configuration | Engineer+ |
| `POST` | `/api/routers/:id/ping` | Test reachability & RADIUS handshake | Engineer+ |
| `GET` | `/api/routers/:id/active-sessions` | Query active PPPoE sessions from RouterOS | Engineer+ |

---

### 3.10 Live RADIUS Sessions (`/api/radius`)

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/radius/sessions/active` | Query ongoing active sessions from `radacct` (acctstoptime IS NULL) | Authenticated |
| `POST` | `/api/radius/sessions/:acctSessionId/disconnect` | Send RFC 3576 Disconnect-Request (PoD) | Engineer+ |
| `GET` | `/api/radius/users/:username/accounting` | Historical session usage and data consumption | Authenticated |

---

### 3.11 Dashboard & Analytics (`/api/dashboard`)

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/dashboard/stats` | KPI summary: Total Subscribers, Active, Suspended, Monthly Revenue, Pending Due | Authenticated |
| `GET` | `/api/dashboard/revenue-chart` | 6-month historical billing vs. collection trends | Authenticated |
| `GET` | `/api/dashboard/recent-activity` | Live feed of recent logins, suspensions, and payments | Authenticated |

---

### 3.12 Audit Trail (`/api/audit-logs`)

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/audit-logs` | Filter audit logs by date, action, entity, or admin user | OrgAdmin |
| `GET` | `/api/audit-logs/:id` | View full before/after JSON diff of administrative operation | OrgAdmin |
