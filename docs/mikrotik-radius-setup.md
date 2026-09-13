# MikroTik RouterOS & FreeRADIUS Integration Guide

**System:** Multi-tenant ISP CRM & Carrier AAA Automation  
**Target Environments:** MikroTik RouterOS v7.x (or v6.x) & FreeRADIUS 3.2+ with PostgreSQL (`rlm_sql`)  
**Security Notice:** All sensitive passwords, RADIUS secrets, and API credentials shown here are sanitized example templates. Never commit production secrets.

---

## 1. Network Topology & Port Mapping

```
[ Subscriber PPPoE Client / ONT ]
              │
              │ PPPoE Discovery (PADI / PADO / PADR / PADS)
              ▼
   [ MikroTik RouterOS Gateway (BNG / NAS) ]
              │
              │  Authentication: UDP 1812
              │  Accounting:     UDP 1813
              │  CoA / PoD:      UDP 3799 (Incoming to MikroTik)
              ▼
    [ FreeRADIUS 3.2+ Server (rlm_sql) ]
              │
              │  PostgreSQL queries to `radcheck`, `radreply`, `radacct`
              ▼
      [ PostgreSQL CRM Database ]
```

### Standard Port Matrix

| Service | Protocol / Port | Direction | Description |
| :--- | :--- | :--- | :--- |
| RADIUS Authentication | UDP 1812 | MikroTik → FreeRADIUS | Access-Request / Access-Accept / Access-Reject |
| RADIUS Accounting | UDP 1813 | MikroTik → FreeRADIUS | Acct-Status-Type (Start, Interim-Update, Stop) |
| RFC 3576 CoA / PoD | UDP 3799 | CRM Worker → MikroTik | Disconnect-Request (PoD) & CoA-Request (Speed Change) |
| RouterOS REST API | TCP 80 / 443 | CRM API → MikroTik | RouterOS v7 REST API for fleet management |
| RouterOS Binary API | TCP 8728 / 8729 | CRM API → MikroTik | RouterOS v6/v7 Winbox API (Alternative) |

---

## 2. MikroTik RouterOS Configuration Commands

Execute these commands in the MikroTik terminal (`/terminal` or Winbox):

### Step 2.1: Configure RADIUS Client
Replace `<FREERADIUS_IP>` with your FreeRADIUS server's IP address and `<SHARED_SECRET>` with your NAS secret.

```routeros
# Add FreeRADIUS server for PPP authentication & accounting
/radius add service=ppp address=<FREERADIUS_IP> secret="<SHARED_SECRET>" authentication-port=1812 accounting-port=1813 timeout=3000ms comment="ISP-CRM-FreeRADIUS"

# Enable incoming RFC 3576 Change of Authorization (CoA) & Packet of Disconnect (PoD)
/radius incoming set accept=yes port=3799
```

### Step 2.2: Configure IP Pool for PPPoE Subscribers
```routeros
# Define local CGNAT or Public IP pool for subscribers
/ip pool add name=pppoe-pool ranges=100.64.10.2-100.64.10.254
```

### Step 2.3: Configure PPP Profile with RADIUS Accounting
```routeros
# Create default PPPoE profile
/ppp profile add name=pppoe-radius-profile \
    local-address=100.64.10.1 \
    remote-address=pppoe-pool \
    use-encryption=yes \
    only-one=yes \
    dns-server=1.1.1.1,8.8.8.8
```

### Step 2.4: Enable RADIUS on PPP AAA
```routeros
# Instruct RouterOS to use RADIUS for subscriber authentication and interim accounting
/ppp aaa set \
    use-radius=yes \
    accounting=yes \
    interim-update=5m
```

### Step 2.5: Enable PPPoE Server Binding
```routeros
# Bind PPPoE service to the subscriber-facing LAN interface (e.g., ether2 or vlan100)
/interface pppoe-server server add \
    service-name="SpeedNet-Broadband" \
    interface=ether2 \
    default-profile=pppoe-radius-profile \
    one-session-per-host=yes \
    authentication=chap,pap \
    disabled=no
```

### Step 2.6: Configure Dedicated Operator API User for ISP CRM
```routeros
# Create group with read/write access for CRM API telemetry and active session inspection
/user group add name=ispcrm-api policy=api,rest-api,read,write,test

# Create API service account
/user add name=crm_operator group=ispcrm-api password="<STRONG_API_PASSWORD>" comment="Managed by ISP CRM"

# Enable REST API (RouterOS v7)
/ip service set www-ssl disabled=no port=443
# Or plain HTTP if isolated management LAN:
/ip service set www disabled=no port=80
```

---

## 3. FreeRADIUS Server Configuration (`rlm_sql`)

The ISP CRM communicates directly with the PostgreSQL database powering FreeRADIUS.

### Step 3.1: NAS Definition in Database (`nas` table)
Whenever a router is added via the CRM (`/routers` UI or API), a corresponding entry is created:
```sql
INSERT INTO nas (nasname, shortname, type, secret, description)
VALUES ('192.168.1.1', 'MikroTik-Core-01', 'mikrotik', '<SHARED_SECRET>', 'Core BNG Gateway');
```

### Step 3.2: Subscriber Provisioning (`radcheck` & `radreply`)
When a subscriber is created or activated:
- **Authentication (`radcheck`):**
  ```sql
  INSERT INTO radcheck (username, attribute, op, value)
  VALUES ('rajesh_fiber', 'Cleartext-Password', ':=', 'Secret123');
  ```
- **Bandwidth Authorization (`radreply`):**
  ```sql
  -- Format: <Upload-Max>/<Download-Max> [bursts] [priority] [min-rate]
  INSERT INTO radreply (username, attribute, op, value)
  VALUES ('rajesh_fiber', 'Mikrotik-Rate-Limit', ':=', '50M/100M 0/0 0/0 0/0 8 25M/50M');
  ```
- **Suspension Policy:**
  When a subscriber expires or is suspended:
  ```sql
  UPDATE radcheck SET value = 'SUSPENDED_BLOCKED' WHERE username = 'rajesh_fiber';
  ```
  And a CoA Disconnect-Request is dispatched to terminate the active session immediately.

---

## 4. Testing & Verification Workflow

### 4.1 Test Authentication from Linux CLI (`radtest`)
From the FreeRADIUS host or container:
```bash
# Syntax: radtest <username> <password> <radius-server-ip> <nas-port> <secret>
radtest test_user_01 TestPass123 127.0.0.1 1812 testing123
```
**Expected Response:**
```
Received Access-Accept Id 1 from 127.0.0.1:1812 to 127.0.0.1:0 length 45
    Mikrotik-Rate-Limit = "20M/50M"
```

### 4.2 Test RFC 3576 Packet of Disconnect (PoD)
```bash
# Disconnect by PPPoE Username
echo "User-Name = rajesh_fiber" | radclient -x 192.168.1.1:3799 disconnect "<SHARED_SECRET>"
```
**Expected Response:**
```
Received Disconnect-ACK Id 1 from 192.168.1.1:3799
```

### 4.3 Test RFC 3576 Change of Authorization (CoA) Speed Change
```bash
# Upgrade active session bandwidth dynamically without disconnect
cat <<EOF | radclient -x 192.168.1.1:3799 coa "<SHARED_SECRET>"
User-Name = rajesh_fiber
Mikrotik-Rate-Limit = "50M/100M"
EOF
```
**Expected Response:**
```
Received CoA-ACK Id 2 from 192.168.1.1:3799
```

---

## 5. Troubleshooting & Diagnostics

| Symptom | Cause | Resolution |
| :--- | :--- | :--- |
| `Access-Reject` returned | Wrong username or password in `radcheck` | Verify `SELECT * FROM radcheck WHERE username = '...'`. |
| Timeout waiting for RADIUS | UDP 1812 blocked by firewall | Allow UDP 1812/1813 in RouterOS firewall (`/ip firewall filter`). |
| CoA Disconnect ignored by MikroTik | Incoming CoA disabled or port mismatch | Verify `/radius incoming print`. Ensure `accept=yes` and port matches (3799). |
| Rate-limit not applied on MikroTik | MikroTik dictionary missing in FreeRADIUS | Ensure `/usr/share/freeradius/dictionary.mikrotik` is included in FreeRADIUS dictionaries. |
| Stale sessions in CRM dashboard | Missing interim accounting | Ensure `/ppp aaa set interim-update=5m` is configured on RouterOS. |
