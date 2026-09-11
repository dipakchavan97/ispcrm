# Development & Operations Guide

## 1. Prerequisites

Ensure your development workstation meets the following minimum requirements:

- **Node.js**: `v20.x` or `v24.x` (Recommended: LTS)
- **Package Manager**: `npm` (v10+ or v11+)
- **Docker**: Docker Desktop / Docker Engine 24+ & Docker Compose v2+
- **Operating System**: Linux, macOS, or Windows (WSL2 / PowerShell)

---

## 2. Monorepo Structure

```
ISPCRM/
├── apps/
│   ├── api/                     # NestJS Modular Monolith REST API (Port 4000)
│   ├── web/                     # Next.js 14 Web Admin Portal (Port 3000)
│   └── worker/                  # BullMQ Background Async Worker (Port 4001)
├── packages/
│   ├── database/                # Prisma ORM schema, client, migrations, seeds
│   └── shared/                  # Shared TypeScript types, enums, DTOs, Zod schemas
├── infrastructure/
│   └── freeradius/              # FreeRADIUS 3.x Dockerfile & SQL configs
├── docs/                        # Architecture, DB, API, Radius, MikroTik guides
├── docker-compose.yml           # Complete local environment orchestration
├── package.json                 # Monorepo root workspace manifest
└── tsconfig.base.json           # Shared TypeScript configuration
```

---

## 3. Environment Variables Configuration

Copy the example environment file to the root and child workspaces:

```bash
# Copy to root
cp .env.example .env

# Distribute to database and service packages
cp .env packages/database/.env
cp .env apps/api/.env
cp .env apps/worker/.env
```

### Critical Environment Variables

| Variable | Default Value | Description |
|---|---|---|
| `PORT` | `4000` | Port for NestJS API |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/ispcrm?schema=public` | Primary PostgreSQL connection URL |
| `REDIS_HOST` | `localhost` | Redis host for BullMQ and caching |
| `REDIS_PORT` | `6379` | Redis port |
| `JWT_SECRET` | `super-secret-jwt-key-change-in-production` | Secret for signing JWT tokens |
| `RADIUS_SECRET` | `testing123` | Default RADIUS shared secret |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000/api` | API endpoint for Next.js frontend |

---

## 4. Running with Docker Compose (Production Environment)

To build and spin up all 6 services (`postgres`, `redis`, `freeradius`, `api`, `worker`, `web`):

### 4.1 Step 1: Build Container Images
```bash
docker compose build
```

### 4.2 Step 2: Start Containers in Background
```bash
docker compose up -d
```

### 4.3 Step 3: Verify Running Status and Health Checks
```bash
docker compose ps
```

Expected healthy output:
```
NAME                IMAGE                STATUS                        PORTS
ispcrm-api          ispcrm-api           Up (healthy)                  0.0.0.0:4000->4000/tcp
ispcrm-freeradius   ispcrm-freeradius    Up                            0.0.0.0:1812-1813->1812-1813/udp, 0.0.0.0:3799->3799/udp
ispcrm-postgres     postgres:16-alpine   Up (healthy)                  0.0.0.0:5432->5432/tcp
ispcrm-redis        redis:7-alpine       Up (healthy)                  0.0.0.0:6379->6379/tcp
ispcrm-web          ispcrm-web           Up (healthy)                  0.0.0.0:3000->3000/tcp
ispcrm-worker       ispcrm-worker        Up (healthy)                  0.0.0.0:4001->4001/tcp
```

### 4.4 Step 4: Verify Individual Service Health Probes
```bash
# 1. API System Probe
curl http://localhost:4000/api/health

# 2. Database Connection Probe
curl http://localhost:4000/api/health/db

# 3. Redis / Queue Probe
curl http://localhost:4000/api/health/redis

# 4. Worker Health Probe
curl http://localhost:4001/health

# 5. Web Frontend Health Probe
curl http://localhost:3000/api/health

# 6. Swagger API Documentation
curl -I http://localhost:4000/api/docs
```

### 4.5 Follow Container Logs
```bash
# Stream all logs
docker compose logs -f

# Follow specific service logs
docker compose logs -f api
docker compose logs -f freeradius
docker compose logs -f worker
```

---

## 5. Local Development Workflow

If you prefer developing locally on your host with live reload while Docker runs PostgreSQL, Redis, and FreeRADIUS:

```bash
# 1. Start storage and network infrastructure in Docker
docker compose up -d postgres redis freeradius

# 2. Install monorepo dependencies
npm install

# 3. Push Prisma schema & generate client
npm run db:push

# 4. Seed initial ISP organization and customer credentials
npm run db:seed

# 5. Run quality checks
npm run lint
npm run typecheck
npm run test
npm run build
```

---

## 6. Database Operations

All database management is orchestrated via the `@isp-crm/database` workspace:

```bash
# Push schema changes directly to PostgreSQL
npm run db:push

# Re-generate Prisma Client
npm run db:generate

# Populate demo ISP organization, admin, plans, and subscribers
npm run db:seed

# Launch Prisma Studio GUI (Visual database browser on http://localhost:5555)
npm run db:studio
```

---

## 7. Quality Assurance Suite

All four quality gates pass cleanly with zero errors:

```bash
# 1. Code Style & Lint
npm run lint

# 2. Strict TypeScript Verification across all 5 workspaces
npm run typecheck

# 3. Automated Unit & Health Suite
npm run test

# 4. Production Monorepo Build
npm run build
```

---

## 8. FreeRADIUS AAA Verification

Verify that FreeRADIUS has established the PostgreSQL connection and is listening for PPPoE packets:

```bash
# Check startup logs
docker logs ispcrm-freeradius

# Verify UDP ports are open
netstat -an | findstr "1812 1813 3799"
```

Look for the confirmation lines in the logs:
```
rlm_sql (sql): Driver rlm_sql_postgresql loaded and linked
rlm_sql (sql): Attempting to connect to database "ispcrm"
Ready to process requests
```
