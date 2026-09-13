# ISPCRM PRODUCTION DEPLOYMENT GUIDE (VERCEL + LINUX VPS)

**Document Version:** 1.0.0  
**Target Architecture:** Hybrid Deployment (Vercel Frontend + Linux VPS Gateway)  
**Date:** September 12, 2026  

---

## Architecture Overview

```
                      [End Users & Administrators]
                                   │
                                   ▼
                    [Vercel Global Edge Network]
                     Frontend: app.yourdomain.com
                                   │
                                   │ HTTPS REST API Calls
                                   ▼
                   [Linux Production VPS Public IP]
    ┌──────────────────────────────┬──────────────────────────────┐
    ▼                              ▼                              ▼
api.yourdomain.com:443     vpn.yourdomain.com:443      1812/1813 UDP
 [Reverse Proxy (Nginx)]       [accel-pppd SSTP]       [FreeRADIUS 3.x]
 (Let's Encrypt SSL)        (Let's Encrypt SSL)        (AAA Engine)
           │                               ▲                      │
           ▼                               │                      ▼
    [ispcrm-api:4000]                      │                [PostgreSQL 16]
           │                               │                      ▲
           ▼                               │                      │
   [10.200.0.0/16 Route]                   │                [Redis 7 (Auth)]
           │                               │                      ▲
           └───────────────────────────────┴──────────────────────┤
                                                                  │
                          [Physical MikroTik BNG]                 │
                          Interface: sstp-ispcrm                  │
                          Assigned IP: 10.200.0.6                 │
                          Binary API: 8728 ───────────────────────┘
```

---

## 1. Step 1: Provision the Linux Production VPS

### Recommended Hardware Specifications
* **CPU:** 4 vCPU (KVM virtualization or Bare Metal)
* **RAM:** 8 GB ECC RAM (minimum 4 GB)
* **Storage:** 80 GB NVMe SSD
* **Operating System:** Ubuntu 22.04 LTS or Ubuntu 24.04 LTS (64-bit)
* **Network:** 1 Gbps port, 1 Dedicated Static Public IPv4 address
* **Kernel Module Requirement:** In-kernel PPP (`CONFIG_PPP=y`, `CONFIG_PPP_MPPE=y`). Standard KVM VPS providers (Hetzner, DigitalOcean, Linode, AWS EC2) meet this natively.

---

## 2. Step 2: Install Required System Packages

Connect via SSH as `root` (or sudo user) and install system dependencies:

```bash
sudo apt-get update && sudo apt-get upgrade -y

# Install core tools, networking utilities, and certbot
sudo apt-get install -y \
    curl \
    wget \
    git \
    ufw \
    fail2ban \
    certbot \
    python3-certbot-nginx \
    nginx \
    iptables \
    iproute2 \
    ca-certificates

# Install Docker and Docker Compose plugin
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Enable and start Docker
sudo systemctl enable --now docker
```

---

## 3. Step 3: Configure Host Firewall (UFW)

Lock down all public ports except SSH, HTTP/HTTPS, and RADIUS:

```bash
# Default policies: Deny incoming, allow outgoing
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (ensure your SSH port is permitted before enabling!)
sudo ufw allow 22/tcp comment "SSH Management"

# Allow HTTP and HTTPS (Web & SSTP)
sudo ufw allow 80/tcp comment "Let's Encrypt ACME Validation"
sudo ufw allow 443/tcp comment "HTTPS REST API & SSTP Concentrator"

# Allow FreeRADIUS AAA
sudo ufw allow 1812/udp comment "FreeRADIUS Authentication"
sudo ufw allow 1813/udp comment "FreeRADIUS Accounting"

# Enable Firewall
sudo ufw enable
sudo ufw status verbose
```

> [!NOTE]
> PostgreSQL (`5432`), Redis (`6379`), API internal port (`4000`), and Worker health (`4001`) are **NEVER** opened in UFW. They communicate strictly over the internal Docker network.

---

## 4. Step 4: Configure DNS Records

At your DNS provider (Cloudflare, Route53, Namecheap, etc.), create these records:

| Record Type | Host / Name | Target / Value | TTL | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **CNAME** | `app` | `cname.vercel-dns.com` | Auto | Next.js Frontend on Vercel |
| **A** | `api` | `<YOUR_VPS_PUBLIC_IP>` | 300s | NestJS Backend REST API |
| **A** | `vpn` | `<YOUR_VPS_PUBLIC_IP>` | 300s | Public SSTP Concentrator |

Verify DNS propagation:
```bash
dig +short api.yourdomain.com
dig +short vpn.yourdomain.com
```

---

## 5. Step 5: Issue Public Let's Encrypt TLS Certificates

Obtain trusted TLS certificates for `vpn.yourdomain.com` and `api.yourdomain.com`:

```bash
# Stop nginx temporarily for standalone certbot validation
sudo systemctl stop nginx || true

# Request certificates
sudo certbot certonly --standalone \
    -d vpn.yourdomain.com \
    -d api.yourdomain.com \
    --agree-tos \
    --email admin@yourdomain.com \
    --non-interactive

# Verify certificates were created
sudo ls -l /etc/letsencrypt/live/vpn.yourdomain.com/
```

Set up automatic renewal hook for the SSTP container:
```bash
sudo tee /etc/letsencrypt/renewal-hooks/post/reload-ispcrm.sh << 'EOF'
#!/bin/sh
docker exec ispcrm-sstp accel-cmd reload 2>/dev/null || docker restart ispcrm-sstp 2>/dev/null || true
systemctl reload nginx 2>/dev/null || true
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/post/reload-ispcrm.sh
```

---

## 6. Step 6: Clone Repository and Configure Environment

```bash
# Create application directory
sudo mkdir -p /opt/ispcrm
sudo chown -R $USER:$USER /opt/ispcrm
cd /opt/ispcrm

# Clone project
git clone <YOUR_GIT_REPOSITORY_URL> .

# Copy and populate production environment
cp .env.production.example .env.production

# Edit environment variables
nano .env.production
```

### Essential Variables to Generate:
```bash
# Generate high-entropy secrets
openssl rand -base64 24    # Use for POSTGRES_PASSWORD
openssl rand -base64 24    # Use for REDIS_PASSWORD
openssl rand -base64 48    # Use for JWT_SECRET
openssl rand -hex 32       # Use for ROUTER_ENCRYPTION_KEY
openssl rand -hex 16       # Use for RADIUS_SECRET
```

Set:
* `CORS_ALLOWED_ORIGINS=https://app.yourdomain.com`
* `SSTP_SERVER_HOST=vpn.yourdomain.com`
* `LETSENCRYPT_CERT_DIR=/etc/letsencrypt/live/vpn.yourdomain.com`

---

## 7. Step 7: Configure Nginx Reverse Proxy for `api.yourdomain.com`

Configure Nginx to proxy `api.yourdomain.com` to internal container port `4000`:

```bash
sudo tee /etc/nginx/sites-available/ispcrm-api << 'EOF'
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/vpn.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vpn.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/ispcrm-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

> [!TIP]
> If sharing port 443 between Nginx and `accel-pppd` on a single IP:
> In Nginx, use `stream` with `ssl_preread on` to route SNI `vpn.yourdomain.com` directly to `127.0.0.1:8443` (where `ispcrm-sstp` listens) and `api.yourdomain.com` to `127.0.0.1:4430` (where Nginx SSL terminates).

---

## 8. Step 8: Build and Launch VPS Services

```bash
# Build and start all production services
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

# Verify all containers are running and healthy
docker compose -f docker-compose.prod.yml ps
```

---

## 9. Step 9: Run Database Migrations & Initial Tenant Seeding

```bash
# Run Prisma schema push to initialize PostgreSQL
docker compose -f docker-compose.prod.yml exec api npx prisma db push --schema=/app/packages/database/prisma/schema.prisma

# Seed default organization and admin account
docker compose -f docker-compose.prod.yml exec api node /app/packages/database/dist/seed.js
```

---

## 10. Step 10: Deploy Next.js Frontend to Vercel

1. Log in to [Vercel Dashboard](https://vercel.com).
2. Click **Add New Project** and import your Git repository.
3. In **Project Settings**:
   * **Root Directory:** Edit and select `apps/web`.
   * **Framework Preset:** `Next.js`.
4. In **Environment Variables**, add:
   * `NEXT_PUBLIC_API_URL` = `https://api.yourdomain.com/api`
   * `NEXT_PUBLIC_APP_NAME` = `ISPCRM Portal`
5. Click **Deploy**.
6. In **Project Settings → Domains**, add:
   * `app.yourdomain.com`
7. Vercel automatically issues and provisions free SSL/TLS certificates.

---

## 11. Step 11: Verify Public Health Endpoints

Test that all public endpoints are responding correctly:

```bash
# 1. Test Backend API health check
curl -s -I https://api.yourdomain.com/api/health
# Expected: HTTP/2 200 OK

# 2. Test Frontend Vercel Web Portal
curl -s -I https://app.yourdomain.com
# Expected: HTTP/2 200 OK

# 3. Test SSTP Server TLS handshake on Port 443
openssl s_client -connect vpn.yourdomain.com:443 -servername vpn.yourdomain.com </dev/null 2>/dev/null | grep -E "CN|Verify return code"
# Expected: Verify return code: 0 (ok)
```

---

## 12. Step 12: Production Router Onboarding (MikroTik)

When registering a router in the Web Portal (`https://app.yourdomain.com/routers/new`):
1. Select Connection Method: **SSTP Tunnel**.
2. Select Target Version: **RouterOS v6** (or v7).
3. Copy the generated script.
4. On the physical MikroTik router (Terminal):
   * Paste the configuration script.
   * Interface `sstp-ispcrm` connects to `vpn.yourdomain.com:443`.
   * Dynamic IP `10.200.0.x` is assigned with `add-default-route=no`.
   * RouterOS API responds to `10.200.0.x:8728`.
5. The portal transitions status to **`ONLINE`** and populates CPU, RAM, and interface telemetry.

---

## 13. Rollback Procedure

If the production deployment needs to be halted or reverted:

```bash
# 1. Stop VPS containers
docker compose -f docker-compose.prod.yml down

# 2. To revert any physical MikroTik test connection (Winbox):
/interface sstp-client remove [find name="sstp-ispcrm"]
/ip dns static remove [find name="vpn.yourdomain.com"]

# 3. Existing XceedNet SSTP, PPPoE subscribers, and default routes remain 100% untouched.
```
