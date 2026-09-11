# ISP CRM, Billing & Bandwidth Management SaaS

A production-oriented, multi-tenant ISP CRM, billing, and bandwidth management platform tailored for small-to-medium Indian Internet Service Providers (ISPs). Built with a **modular monolith** architecture to achieve a high-velocity 7-day MVP without microservices complexity.

---

## Key Features Supported

1. **Multi-Tenant ISP Organizations**: Complete data and operational isolation per ISP tenant.
2. **Admin Users & RBAC**: Granular roles (SuperAdmin, OrgAdmin, Billing Operator, Network Engineer, Technician).
3. **PPPoE Subscriber CRM**: Customer lifecycle, contact details, installation address, Aadhaar KYC compliance.
4. **Internet Plans & Policies**: Speed tiers (Mbps), validity periods (days), FUP limits, burst thresholds.
5. **Subscription Engine**: Plan assignments, activation/expiry tracking, renewal workflows.
6. **GST Billing & Invoices**: Telecom SAC code `998422`, CGST/SGST/IGST breakdown, automated cycle billing.
7. **Payment Receipts**: Cash collection, UPI transaction reference capture, automatic account reactivation.
8. **MikroTik Router Integration**: Dynamic queue bandwidth control via `Mikrotik-Rate-Limit`.
9. **FreeRADIUS 3.x Engine**: Database-backed AAA (`rlm_sql`) co-located with CRM in PostgreSQL.
10. **RFC 3576 / RFC 5176 CoA/PoD**: Instant subscriber suspension and re-authorization via Disconnect-Requests on UDP port 3799.
11. **BullMQ Background Workers**: Asynchronous billing cycles, router telemetry heartbeats, and packet dispatchers.
12. **Audit Trail**: Complete traceability of administrative actions with change diffs.
13. **Modern Operations Dashboard**: Responsive Next.js 14 Web UI with dark mode and live status metrics.

---

## Project Structure

```
ISPCRM/
├── apps/
│   ├── api/                     # NestJS Modular Monolith REST API (Port 4000)
│   ├── web/                     # Next.js 14 Web Portal (Port 3000)
│   └── worker/                  # BullMQ Background Worker (Port 4001)
├── packages/
│   ├── database/                # Prisma ORM schema & client
│   └── shared/                  # Shared TypeScript types, enums, DTOs, Zod schemas
├── infrastructure/
│   └── freeradius/              # FreeRADIUS 3.x Dockerfile & SQL configs
├── docs/                        # Complete technical architecture specifications
├── docker-compose.yml           # PostgreSQL, Redis, FreeRADIUS, API, Web, Worker
└── package.json                 # Monorepo root workspace
```

---

## Quick Start with Docker Compose

Spin up all 6 services with automated health checks:

```bash
# Start all containers
docker compose up -d

# Verify container health
docker compose ps

# Follow logs
docker compose logs -f
```

- **Web Admin Dashboard**: [http://localhost:3000](http://localhost:3000)
- **API Health Check**: [http://localhost:4000/api/health](http://localhost:4000/api/health)
- **Swagger Documentation**: [http://localhost:4000/api/docs](http://localhost:4000/api/docs)
- **FreeRADIUS Ports**: `1812/udp` (Auth), `1813/udp` (Acct), `3799/udp` (CoA)

---

## Documentation Index

- [Architecture Guide](docs/architecture.md)
- [Database & FreeRADIUS Schema](docs/database.md)
- [REST API Specification](docs/api.md)
- [FreeRADIUS AAA Integration](docs/radius.md)
- [MikroTik RouterOS PPPoE Guide](docs/mikrotik.md)
- [Development & Operations Guide](docs/development.md)
