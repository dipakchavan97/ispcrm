# FreeRADIUS 3.x Integration Architecture

## 1. Overview & Architecture

FreeRADIUS 3.x serves as the AAA (Authentication, Authorization, and Accounting) engine mediating between MikroTik PPPoE Network Access Servers (NAS) and the central PostgreSQL database.

```
+------------------+         +------------------+         +--------------------+
|  MikroTik Router |         | FreeRADIUS 3.x   |         | PostgreSQL 16      |
|  (PPPoE NAS)     |         | (rlm_sql Driver) |         | (Unified Database) |
+------------------+         +------------------+         +--------------------+
         |                            |                              |
         |-- 1. Access-Request ------>|                              |
         |   (User, Pass, NAS-IP)     |-- 2. Query radcheck -------->|
         |                            |<-- Pass, Attributes ---------|
         |                            |-- 3. Query radreply -------->|
         |                            |<-- Mikrotik-Rate-Limit ------|
         |<-- 4. Access-Accept -------|                              |
         |   (With Rate-Limit VSA)    |                              |
         |                            |                              |
         |-- 5. Acct-Start (1813) --->|-- 6. Insert radacct -------->|
         |-- 7. Acct-Interim (1813) ->|-- 8. Update radacct -------->|
         |-- 9. Acct-Stop (1813) ---->|-- 10. Finalize radacct ----->|
         |                            |                              |
```

---

## 2. AAA Database Mapping

FreeRADIUS accesses PostgreSQL using the `rlm_sql` driver with standard queries:

### 2.1 Authentication (`radcheck`)
Contains the subscriber's identity and validation criteria:
- **`username`**: PPPoE username (e.g., `user_rajesh`).
- **`attribute`**: `Cleartext-Password` (or `Crypt-Password` / `MD5-Password`).
- **`op`**: `:=` or `==`.
- **`value`**: The plaintext or hashed subscriber secret.

**Suspension Mechanism**:
When a subscriber is suspended, the CRM changes `attribute` to `Auth-Type` and `value` to `Reject`, or changes the password to an invalid hash. Any subsequent `Access-Request` immediately returns `Access-Reject`.

### 2.2 Authorization & Bandwidth Attributes (`radreply`)
Supplies MikroTik Vendor-Specific Attributes (VSAs) returned in the `Access-Accept` packet:

| Attribute Name | Op | Value Example | Meaning |
|---|---|---|---|
| `Mikrotik-Rate-Limit` | `=` | `20M/100M` | 20 Mbps Upload / 100 Mbps Download |
| `Mikrotik-Rate-Limit` (with Burst) | `=` | `20M/100M 30M/150M 10M/70M 16/16 8` | Rate, Burst-rate, Threshold, Burst-time, Priority |
| `Framed-IP-Address` | `=` | `10.100.4.15` | Static IP assignment (optional) |
| `Framed-Pool` | `=` | `pool_subscribers` | IP pool defined on MikroTik |
| `Session-Timeout` | `=` | `86400` | Force re-auth after 24 hours (optional) |

### 2.3 Accounting (`radacct`)
MikroTik streams accounting packets to port 1813 (UDP):
- `Acct-Status-Type = Start`: Initiates session, sets `acctstarttime` and IP address.
- `Acct-Status-Type = Interim-Update`: Periodic telemetry (default every 5 minutes), updating `acctinputoctets` (bytes downloaded) and `acctoutputoctets` (bytes uploaded).
- `Acct-Status-Type = Stop`: Closes session, sets `acctstoptime`, session duration (`acctsessiontime`), and `acctterminatecause` (e.g. `User-Request`, `Lost-Carrier`).

---

## 3. MikroTik Vendor-Specific Attributes (VSA) Specification

The MikroTik dictionary (Vendor ID `14988`) provides explicit controls:

### `Mikrotik-Rate-Limit` Format
```
rx-rate[/tx-rate] [rx-burst-rate[/tx-burst-rate] [rx-burst-threshold[/tx-burst-threshold] [rx-burst-time[/tx-burst-time] [priority] [rx-rate-min[/tx-rate-min]]]]
```
*Note: In MikroTik terminology, `rx` is Client Upload, and `tx` is Client Download.*

#### Examples:
1. **Simple 50 Mbps Symmetric**:
   `50M/50M`
2. **20 Mbps Upload, 100 Mbps Download with 150 Mbps Burst for 10 seconds**:
   `20M/100M 30M/150M 15M/80M 10/10 8 10M/50M`
3. **Suspended Walled-Garden Throttle (128 kbps)**:
   `128k/128k`

---

## 4. Disconnect-Request (PoD / CoA RFC 3576 & RFC 5176)

When an administrator suspends an active subscriber or updates a bandwidth tier, the subscriber's session must be terminated immediately on the MikroTik router without waiting for the physical lease to expire.

### 4.1 Packet Structure
The API or BullMQ worker transmits an RFC 3576 **Disconnect-Request** UDP packet to the MikroTik router on port `3799`:

```
Code: 40 (Disconnect-Request)
Identifier: Random (0-255)
Authenticator: MD5(Code + ID + Length + Request-Authenticator + Attributes + Secret)
Attributes:
  - User-Name = "user_rajesh"
  - Framed-IP-Address = "10.100.4.15"
  - NAS-IP-Address = "192.168.88.1"
```

### 4.2 Expected Router Response
- **Code 41 (Disconnect-ACK)**: Session terminated successfully.
- **Code 42 (Disconnect-NAK)**: Session not found, secret mismatch, or CoA disabled.

### 4.3 Node.js / TypeScript CoA Implementation Example
`apps/worker` uses raw UDP sockets to dispatch Disconnect-Requests:

```typescript
import dgram from 'node:dgram';
import crypto from 'node:crypto';

export function sendDisconnectRequest(
  routerIp: string,
  coaPort: number,
  sharedSecret: string,
  username: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    // Encode RFC 3576 Disconnect-Request packet buffer
    // Calculate MD5 Authenticator using sharedSecret
    // Send packet to routerIp:coaPort
  });
}
```

---

## 5. FreeRADIUS Configuration Blueprint

### 5.1 `mods-available/sql` (PostgreSQL Driver)
```conf
sql {
    driver = "rlm_sql_postgresql"
    dialect = "postgresql"

    server = "postgres"
    port = 5432
    login = "postgres"
    password = "password"
    radius_db = "ispcrm"

    read_clients = yes
    client_table = "nas"

    # Reference standard postgresql schema queries
    $INCLUDE ${modconfdir}/${.:name}/main/postgresql/queries.conf
}
```

### 5.2 `sites-available/default`
Enabled sections:
- `authorize`: `sql` module enabled to evaluate `radcheck` and `radreply`.
- `authenticate`: Default PAP and CHAP modules.
- `accounting`: `sql` module enabled to insert and update `radacct`.

### 5.3 Diagnostic & Verification Tools
- **Run in Foreground Debug Mode**:
  `docker compose exec freeradius freeradius -X`
- **Simulate PPPoE Authentication using `radtest`**:
  `docker compose exec freeradius radtest user_rajesh pass123 localhost 1812 testing123`
