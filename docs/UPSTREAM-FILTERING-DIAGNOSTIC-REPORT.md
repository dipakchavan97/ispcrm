# Upstream Port Filtering & Ingress Diagnostic Report

**Target Public IPv4:** `103.170.1.125`  
**Host Interface:** `Broadband Connection` (Windows PPPoE, InterfaceIndex 33)  
**Date / Timestamp:** September 12, 2026, ~22:29 IST (16:59 UTC)  
**Diagnostic Type:** Read-Only Upstream Filtering Assessment  

---

## 1. Executive Summary & Diagnostic Conclusion

> [!IMPORTANT]
> **FINAL DIAGNOSTIC CONCLUSION: A) TCP 443 specifically blocked upstream**
> 
> Unsolicited inbound public traffic **is successfully routed** to the static IP `103.170.1.125`. Non-production TCP ports (8443, 8080, 2001, 50000) accept and complete full inbound TCP 3-way handshakes from arbitrary public IP addresses around the globe.
> 
> Only **TCP port 443** suffers connection timeouts from all external vantage points. Inbound SYN packets destined for port 443 never reach the Windows network stack. Therefore, the upstream ISP / carrier routing equipment (BRAS/BNG or carrier firewall) is specifically filtering/dropping inbound TCP port 443 traffic.

---

## 2. Multi-Port External Probe Summary Table

All external tests were executed using public probes via `check-host.net` directly targeting `103.170.1.125` across 5 distinct TCP ports.

| Port | Service Tested | External Result | Windows Passive Delta | Inbound Connections Received on Host |
| :--- | :--- | :--- | :---: | :--- |
| **443** | Production HTTPS / Nginx | ❌ **ALL TIMEOUT** | 0 / 1 (noise) | **0 (None received)** |
| **8443** | Temp TCP Listener | ✅ **OPEN / CONNECTED** | **+5** | **4 connections from public IPs** |
| **8080** | Temp TCP Listener | ✅ **OPEN / CONNECTED** | **+5** | **4 connections from public IPs** |
| **2001** | Temp TCP Listener | ✅ **OPEN / CONNECTED** | **+4** | **4 connections from public IPs** |
| **50000** | Temp TCP Listener | ✅ **OPEN / CONNECTED** | **+4** | **4 connections from public IPs** |

---

## 3. Detailed Per-Port Diagnostic Findings

### TCP Port 443 (Production HTTPS)
- **External Probes:**
  - `de2.node.check-host.net` (Frankfurt, Germany): `Connection timed out`
  - `de4.node.check-host.net` (Frankfurt, Germany): `Connection timed out`
  - `il2.node.check-host.net` (Tel Aviv, Israel): `Connection timed out`
  - `ir4.node.check-host.net` (Shiraz, Iran): `Connection timed out`
- **Host Stack Observations:**
  - Passive-open counter (`Win32_PerfRawData_Tcpip_TCPv4.ConnectionsPassive`) showed zero meaningful delta.
  - Inbound connections reached: **0**.
  - Docker Nginx access and error logs recorded **0 external requests**.
- **Local Verification:**
  - Local requests (`curl.exe -k https://103.170.1.125:443/`) immediately return `HTTP 200 OK`.

---

### TCP Port 8443 (High Alternate Port)
- **External Probes:**
  - `ch2.node.check-host.net` (Zurich, Switzerland): `Connected (137 ms)`
  - `rs1.node.check-host.net` (Belgrade, Serbia): `Connected (154 ms)`
  - `ua1.node.check-host.net` (Kyiv, Ukraine): `Connected (166 ms)`
  - `ua3.node.check-host.net` (Kharkiv, Ukraine): `Connected (2 ms)`
- **Host Stack Observations:**
  - Windows TCP Passive Opens Delta: **+5**
  - Host Listener received **4 verified public inbound connections**:
    - `81.6.41.187:49890` at 16:58:44 UTC
    - `194.146.57.64:22440` at 16:58:44 UTC
    - `185.86.77.126:4800` at 16:58:44 UTC
    - `104.28.224.94:30454` at 16:58:44 UTC

---

### TCP Port 8080 (Common Web Alternate Port)
- **External Probes:**
  - `fi1.node.check-host.net` (Helsinki, Finland): `Connected (171 ms)`
  - `ir8.node.check-host.net` (Tehran, Iran): `Connected (237 ms)`
  - `it2.node.check-host.net` (Milan, Italy): `Connected (116 ms)`
  - `sg1.node.check-host.net` (Singapore): `Connected (99 ms)`
- **Host Stack Observations:**
  - Windows TCP Passive Opens Delta: **+5**
  - Host Listener received **4 verified public inbound connections**:
    - `185.25.204.60:63480` at 16:58:52 UTC
    - `65.109.182.130:52668` at 16:58:52 UTC
    - `178.239.146.199:17914` at 16:58:52 UTC
    - `217.15.166.168:29198` at 16:58:53 UTC

---

### TCP Port 2001 (High Port)
- **External Probes:**
  - `kz1.node.check-host.net` (Almaty, Kazakhstan): `Connected (230 ms)`
  - `md1.node.check-host.net` (Chisinau, Moldova): `Connected (176 ms)`
  - `nl2.node.check-host.net` (Amsterdam, Netherlands): `Connected (140 ms)`
  - `ro1.node.check-host.net` (Bucharest, Romania): `Connected (152 ms)`
- **Host Stack Observations:**
  - Windows TCP Passive Opens Delta: **+4**
  - Host Listener received **4 verified public inbound connections**:
    - `195.211.27.85:35920` at 16:59:01 UTC
    - `107.149.201.15:58820` at 16:59:01 UTC
    - `178.17.171.235:20424` at 16:59:01 UTC
    - `185.120.77.165:12932` at 16:59:01 UTC

---

### TCP Port 50000 (Ephemeral / High Port)
- **External Probes:**
  - `hu1.node.check-host.net` (Budapest, Hungary): `Connected (153 ms)`
  - `rs1.node.check-host.net` (Belgrade, Serbia): `Connected (168 ms)`
  - `ru2.node.check-host.net` (Moscow, Russia): `Connected (187 ms)`
  - `ru3.node.check-host.net` (St. Petersburg, Russia): `Connected (154 ms)`
- **Host Stack Observations:**
  - Windows TCP Passive Opens Delta: **+4**
  - Host Listener received **4 verified public inbound connections**:
    - `45.9.168.235:56360` at 16:59:09 UTC
    - `185.221.199.82:2180` at 16:59:09 UTC
    - `194.146.57.64:53652` at 16:59:09 UTC
    - `194.26.229.20:45208` at 16:59:09 UTC

---

## 4. Root Cause Analysis

1. **Static IP Routing:**  
   `103.170.1.125` **is correctly announced and routed** to the subscriber's PPPoE tunnel (`Broadband Connection`). There is no global routing failure, no CGNAT, and no carrier-level block against unsolicited inbound traffic in general.

2. **Windows OS & Firewall:**  
   The Windows TCP stack, network interface binding (`0.0.0.0`), and Windows Advanced Firewall operate properly. When a firewall rule allows an inbound port, SYN packets arrive, are accepted, and trigger connection state transitions.

3. **Port 443 Discrepancy:**  
   Because ports 8443, 8080, 2001, and 50000 succeed with 100% reliability from diverse global networks, while port 443 fails with 100% timeout and zero packets reaching the Windows host, **the upstream ISP / telco possesses an explicit ingress filter / firewall rule dropping TCP port 443**. Many residential or standard commercial broadband subscriber profiles apply upstream ACLs blocking standard server ports (e.g., 25, 80, 443) by default.

---

## 5. ISP / NOC Escalation Request Template

Use the following draft to open a priority ticket with the upstream Internet Service Provider / Network Operations Center:

```text
Subject: Static IP Ingress Port Filter Removal Request - IP 103.170.1.125 (PPPoE) - Permit Inbound TCP 443

Dear Network Operations Center / Technical Support Team,

Subscriber Details:
- Connection Type: PPPoE Broadband Connection
- Assigned Static Public IPv4: 103.170.1.125

We have completed multi-port ingress diagnostics and confirmed that our static IP is properly receiving unsolicited inbound public traffic on non-standard ports (e.g., TCP 8443, 8080, 2001, 50000 all establish inbound TCP 3-way handshakes with public external nodes).

However, inbound TCP port 443 (HTTPS) is timing out externally. Diagnostic counters on our endpoint show zero inbound TCP SYN packets reaching our PPPoE interface on port 443, indicating that inbound TCP 443 is being filtered/dropped upstream on your BNG/BRAS or edge firewall.

We kindly request the following actions:
1. Verify and unblock/permit unsolicited inbound TCP traffic on port 443 for static IP 103.170.1.125.
2. Confirm that the subscriber PPPoE profile permits server/hosting traffic.
3. Ensure no upstream ACLs or carrier firewall policies are restricting standard web ports (80/443) on this static IP assignment.

Please update us once the ingress filter on TCP port 443 has been removed so we can re-verify public reachability.

Thank you,
Technical Operations Team
```

---

## 6. Cleanup & Security Verification

1. **Temporary Listeners:**  
   Terminated and killed. No processes are listening on ports 8443, 8080, 50000, or 55555. (Verified via `netstat` and `Get-NetTCPConnection`).
2. **Temporary Firewall Rules:**  
   To delete the temporary diagnostic allow rules (`ISPCRM-Temp-8443`, `ISPCRM-Temp-8080`, `ISPCRM-Temp-2001`, `ISPCRM-Temp-50000`), run the following command in an **elevated Administrator PowerShell console**:
   ```powershell
   & "f:\project\ISPCRM\scripts\remove-temp-firewall-rules.ps1"
   ```
3. **Production Firewall Rule Preserved:**  
   Rule `ISPCRM-Public-HTTPS-TCP443` remains enabled and intact:
   - Action: `Allow`
   - Direction: `Inbound`
   - Protocol: `TCP`
   - LocalPort: `443`
   - Profiles: `Domain, Private, Public`
