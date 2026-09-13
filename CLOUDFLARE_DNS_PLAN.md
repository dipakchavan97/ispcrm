# CLOUDFLARE DNS CONFIGURATION PLAN
## Domain: `cloudsetup.in` | Dedicated ISPCRM Service Subdomains

**Date:** September 12, 2026  
**Domain Under Management:** `cloudsetup.in`  
**Host Target IPv4:** `103.170.1.125` (Static Public IP on Broadband Connection)  
**Lead Architect:** Antigravity Principal Cloud & Network Architect  
**Status:** **AWAITING OPERATOR APPROVAL — ZERO CHANGES APPLIED**  

---

## 1. Critical Coexistence Rules & Non-Interference Mandate

> [!CAUTION]
> **EXISTING TENANT / WILDCARD PROJECT SAFETY MANDATE:**
> The domain `cloudsetup.in` hosts an active, independent project utilizing tenant subdomains (e.g. `*.cloudsetup.in` or specific root/tenant A/CNAME records).
> 
> 1. **DO NOT MODIFY, DELETE, OR REPLACE ANY EXISTING DNS RECORDS.**
> 2. **DO NOT TOUCH EXISTING WILDCARD (`*`) OR APEX (`@`) RECORDS.**
> 3. Only add the two dedicated subdomains explicitly specified below: `app` and `vpn`.
> 4. In accordance with RFC 1034 / RFC 4592 and Cloudflare DNS resolution hierarchy, **explicit subdomain records take absolute priority over wildcard records**. Adding `app.cloudsetup.in` and `vpn.cloudsetup.in` will cleanly route ISPCRM traffic to `103.170.1.125` with **zero impact** on existing tenant subdomains.

---

## 2. Exact Cloudflare DNS Records to Add

When approved by the operator, navigate to **Cloudflare Dashboard > cloudsetup.in > DNS > Records** and add ONLY the following two records:

| Record Type | Name / Subdomain | IPv4 Address | Proxy Status | TTL | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **A** | `app` | `103.170.1.125` | **DNS only (Gray Cloud)** *(See Section 3)* | Auto (or 300) | ISPCRM Web Portal & HTTPS REST API Gateway |
| **A** | `vpn` | `103.170.1.125` | **DNS only (Gray Cloud)** *(MANDATORY)* | Auto (or 300) | ISPCRM SSTP VPN Concentrator for MikroTik Routers |

Optional / Recommended for Certificate Authority Authorization:
| Record Type | Name | Content / Flags | TTL | Description |
| :--- | :--- | :--- | :--- | :--- |
| **CAA** | `@` (or `app`/`vpn`) | `0 issue "letsencrypt.org"` | Auto | Grants Let's Encrypt permission to issue certificates |

---

## 3. Proxy Status Analysis: Orange Cloud vs Gray Cloud

### 3.1 `vpn.cloudsetup.in` — STRICTLY DNS-ONLY (Gray Cloud)
* **Configuration:** **DNS only** (Proxy disabled / Gray cloud icon).
* **Technical Reason:**
  * Cloudflare's HTTP proxy only understands Layer 7 HTTP/1.1, HTTP/2, and HTTP/3.
  * The SSTP protocol, while transmitted over TCP 443, is an encapsulated tunneling protocol (`SSTP_DUPLEX_POST` with infinite `Content-Length: 18446744073709551615`, PPP LCP, MS-CHAPv2, and MPPE data streams).
  * If Orange Cloud is enabled on `vpn`, Cloudflare will terminate the TLS session at the Cloudflare Edge, inspect the payload, fail to understand the non-HTTP duplex stream, and terminate the connection with an `HTTP 520 / 400 Bad Request`.
  * Furthermore, MikroTik SSTP client validates the server certificate against the exact hostname (`verify-server-certificate=yes`).
  * **Rule:** `vpn.cloudsetup.in` **MUST NEVER BE PROXIED THROUGH CLOUDFLARE**.

### 3.2 `app.cloudsetup.in` — Staged Deployment Recommendation

#### Phase 1: Initial Deployment & Verification (DNS-Only / Gray Cloud) — RECOMMENDED
* **Configuration:** **DNS only** (Gray cloud icon).
* **Benefits:**
  * Direct end-to-end TLS handshake between the browser and our on-premises Nginx reverse proxy.
  * Let's Encrypt ACME HTTP-01 challenge verification passes straight through without Cloudflare WAF or "Always Use HTTPS" edge interference.
  * Direct visibility into latency, logs, and connection health during go-live.

#### Phase 2: Post-Verification (Optional: Proxied / Orange Cloud)
* If DDoS mitigation, Cloudflare CDN caching for Next.js static assets, and Web Application Firewall (WAF) are desired:
  * In Cloudflare Dashboard, set SSL/TLS encryption mode to **Full (strict)**.
  * Switch `app` to **Proxied (Orange cloud)**.
  * *Prerequisite:* Our on-premises Nginx reverse proxy must already have a valid Let's Encrypt public certificate installed (Full strict validates origin certificate).

---

## 4. Let's Encrypt Public TLS Certificate Issuance Options

Because both `app.cloudsetup.in` and `vpn.cloudsetup.in` share `103.170.1.125:443`, certificate issuance must be completely non-disruptive.

### Comparison of ACME Challenge Methods:

| Challenge Method | Inbound Port Needed | Cloudflare API Token Needed | Disrupts Port 443 / SSTP? | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **DNS-01 (Cloudflare API)** | **NONE (0 ports)** | **Yes (Scoped Token)** | **NO (Zero impact)** | **GOLD STANDARD** |
| **HTTP-01 (Webroot)** | TCP 80 | No | **NO (Port 80 only)** | **STANDARD ALTERNATIVE** |
| **TLS-ALPN-01** | TCP 443 | No | **YES (Port conflict)** | **DO NOT USE** |

---

### Option A: DNS-01 Challenge via Cloudflare API (Gold Standard — Zero Inbound Ports)

Certbot interacts directly with Cloudflare DNS API to automatically create temporary `_acme-challenge` TXT records and immediately delete them upon validation.
* **Key Advantage:** Port 80 does **NOT** need to be opened in Windows Firewall. Port 443 and active SSTP connections are 100% untouched.

#### Step 1: Create Scoped Cloudflare API Token
1. In Cloudflare Dashboard, go to **My Profile > API Tokens > Create Token**.
2. Template: **Edit zone DNS**.
3. Permissions: `Zone - DNS - Edit`, `Zone - Zone - Read`.
4. Zone Resources: `Include - Specific zone - cloudsetup.in`.
5. Save the token in a secure credentials file (e.g. `C:\Users\Dipak\.cloudflare\cloudflare.ini`):
   ```ini
   dns_cloudflare_api_token = YOUR_CLOUDFLARE_SCOPED_TOKEN
   ```

#### Step 2: Issue Certificate via Certbot
```bash
certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /path/to/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 30 \
  -d app.cloudsetup.in \
  -d vpn.cloudsetup.in
```

---

### Option B: HTTP-01 Challenge via Nginx Webroot (Standard Alternative)

If a Cloudflare API token is not available, use the standard ACME HTTP-01 challenge over port 80:
* Nginx serves the challenge from `/var/www/certbot` on `http://app.cloudsetup.in/.well-known/acme-challenge/` and `http://vpn.cloudsetup.in/.well-known/acme-challenge/`.
* SSTP on TCP 443 is completely unaffected.

```bash
certbot certonly --webroot \
  -w ./certbot_www \
  -d app.cloudsetup.in \
  -d vpn.cloudsetup.in
```
*(Requires port 80 allowed inbound on Windows Firewall during renewal).*

---

## 5. Verification Commands

Once the records are added in Cloudflare, verify from an external terminal or PowerShell:

```powershell
# 1. Verify app.cloudsetup.in resolves directly to the PC public IP
Resolve-DnsName -Name app.cloudsetup.in -Type A

# Expected Output:
# Name              Type   TTL   Section   IPAddress
# ----              ----   ---   -------   ---------
# app.cloudsetup.in A      300   Answer    103.170.1.125

# 2. Verify vpn.cloudsetup.in resolves directly to the PC public IP
Resolve-DnsName -Name vpn.cloudsetup.in -Type A

# Expected Output:
# Name              Type   TTL   Section   IPAddress
# ----              ----   ---   -------   ---------
# vpn.cloudsetup.in A      300   Answer    103.170.1.125
```
