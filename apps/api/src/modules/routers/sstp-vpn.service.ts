import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import * as dns from 'node:dns';
import { prisma } from '@isp-crm/database';
import { SstpConfigResult } from '@isp-crm/shared';
import { decryptCredential } from '../../common/utils/crypto.util';

@Injectable()
export class SstpVpnService implements OnModuleInit {
  private readonly logger = new Logger(SstpVpnService.name);

  // Default management VPN subnet 10.200.0.0/16
  private readonly vpnSubnetOctet1 = 10;
  private readonly vpnSubnetOctet2 = 200;

  private readonly chapSecretsPath = process.env.CHAP_SECRETS_PATH || '/etc/ppp/chap-secrets';
  private readonly caCertPath = process.env.SSTP_CA_CERT_PATH || '/etc/ssl/sstp/ca.crt';

  async onModuleInit() {
    try {
      await this.syncAllRouters();
    } catch (err: any) {
      this.logger.warn(`Failed to initialize chap-secrets on startup: ${err.message}`);
    }
    this.setupVpnRoute();
  }

  /**
   * Automatically adds kernel route to 10.200.0.0/16 via the sstp container gateway.
   */
  setupVpnRoute() {
    try {
      const sstpHost = process.env.SSTP_SERVICE_HOST || 'sstp';
      dns.lookup(sstpHost, (err, address) => {
        if (!err && address) {
          child_process.exec(`ip route replace 10.200.0.0/16 via ${address}`, (execErr) => {
            if (execErr) {
              this.logger.debug(`Kernel route configuration note: ${execErr.message}`);
            } else {
              this.logger.log(`Configured kernel route: 10.200.0.0/16 via ${address} (${sstpHost})`);
            }
          });
        }
      });
    } catch (e: any) {
      this.logger.debug(`setupVpnRoute: ${e.message}`);
    }
  }

  /**
   * Synchronizes all SSTP routers from the database to /etc/ppp/chap-secrets.
   */
  async syncAllRouters(): Promise<void> {
    try {
      const routers = await prisma.router.findMany({
        where: {
          connectionMethod: 'SSTP_TUNNEL',
          vpnUsername: { not: null },
          encryptedVpnSecret: { not: null },
          vpnIp: { not: null },
        },
      });

      const lines = [
        '# Secrets for authentication using CHAP',
        '# client\tserver\tsecret\t\t\tIP addresses',
      ];

      for (const r of routers) {
        if (!r.vpnUsername || !r.encryptedVpnSecret || !r.vpnIp) continue;
        try {
          const secretPlain = decryptCredential(r.encryptedVpnSecret);
          lines.push(`"${r.vpnUsername}"\t*\t"${secretPlain}"\t${r.vpnIp}`);
        } catch (decErr: any) {
          this.logger.error(`Failed to decrypt VPN secret for router ${r.name}: ${decErr.message}`);
        }
      }

      this.writeChapSecretsFile(lines.join('\n') + '\n');
      this.logger.log(`Synchronized ${routers.length} SSTP routers to ${this.chapSecretsPath}`);
    } catch (err: any) {
      this.logger.warn(`syncAllRouters encountered error: ${err.message}`);
    }
  }

  /**
   * Appends or updates a single router entry in /etc/ppp/chap-secrets.
   */
  async syncChapSecrets(params: { username: string; passwordPlain: string; vpnIp: string }): Promise<void> {
    try {
      let content = '';
      if (fs.existsSync(this.chapSecretsPath)) {
        content = fs.readFileSync(this.chapSecretsPath, 'utf8');
      } else {
        content = '# Secrets for authentication using CHAP\n# client\tserver\tsecret\t\t\tIP addresses\n';
      }

      const lines = content.split('\n');
      const targetPrefix = `"${params.username}"`;
      let found = false;

      const updatedLines = lines.map((line) => {
        if (line.trim().startsWith(targetPrefix) || line.trim().startsWith(params.username)) {
          found = true;
          return `"${params.username}"\t*\t"${params.passwordPlain}"\t${params.vpnIp}`;
        }
        return line;
      });

      if (!found) {
        // Find last non-empty line
        let insertIndex = updatedLines.length;
        while (insertIndex > 0 && updatedLines[insertIndex - 1].trim() === '') {
          insertIndex--;
        }
        updatedLines.splice(insertIndex, 0, `"${params.username}"\t*\t"${params.passwordPlain}"\t${params.vpnIp}`);
      }

      this.writeChapSecretsFile(updatedLines.join('\n').trim() + '\n');
      this.logger.log(`Added/Updated credentials for SSTP user ${params.username} -> ${params.vpnIp}`);
    } catch (err: any) {
      this.logger.warn(`Failed to sync credentials to chap-secrets: ${err.message}`);
    }
  }

  /**
   * Removes credentials for a router from /etc/ppp/chap-secrets.
   */
  async removeChapSecrets(username: string): Promise<void> {
    try {
      if (!fs.existsSync(this.chapSecretsPath)) return;
      const content = fs.readFileSync(this.chapSecretsPath, 'utf8');
      const lines = content.split('\n');
      const targetPrefix = `"${username}"`;
      const filtered = lines.filter(
        (line) => !line.trim().startsWith(targetPrefix) && !line.trim().startsWith(username),
      );
      this.writeChapSecretsFile(filtered.join('\n').trim() + '\n');
      this.logger.log(`Removed credentials for SSTP user ${username} from ${this.chapSecretsPath}`);
    } catch (err: any) {
      this.logger.warn(`Failed to remove credentials from chap-secrets: ${err.message}`);
    }
  }

  private writeChapSecretsFile(content: string) {
    try {
      const dir = path.dirname(this.chapSecretsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.chapSecretsPath, content, { mode: 0o600 });
    } catch (err: any) {
      this.logger.warn(`Unable to write to ${this.chapSecretsPath}: ${err.message}`);
    }
  }

  /**
   * Retrieves the ISPCRM Root CA certificate for client verification.
   */
  getRootCaCertificate(): string {
    try {
      if (fs.existsSync(this.caCertPath)) {
        return fs.readFileSync(this.caCertPath, 'utf8');
      }
    } catch (err: any) {
      this.logger.warn(`Unable to read CA certificate at ${this.caCertPath}: ${err.message}`);
    }

    return '-----BEGIN CERTIFICATE-----\n# CA certificate will be generated when SSTP container starts\n-----END CERTIFICATE-----\n';
  }

  /**
   * Allocates the next available private management IP from the 10.200.0.0/16 pool.
   * IP range: 10.200.0.2 - 10.200.255.254 (10.200.0.1 is the central VPN gateway)
   */
  async allocateNextVpnIp(): Promise<string> {
    const existingRouters = await prisma.router.findMany({
      where: { vpnIp: { not: null } },
      select: { vpnIp: true },
    });

    const usedIps = new Set<string>();
    for (const r of existingRouters) {
      if (r.vpnIp) usedIps.add(r.vpnIp.trim());
    }

    // Iterate through /16 space starting at 10.200.0.2
    for (let octet3 = 0; octet3 <= 255; octet3++) {
      const startOctet4 = octet3 === 0 ? 2 : 1;
      const endOctet4 = 254;

      for (let octet4 = startOctet4; octet4 <= endOctet4; octet4++) {
        const candidateIp = `${this.vpnSubnetOctet1}.${this.vpnSubnetOctet2}.${octet3}.${octet4}`;
        if (!usedIps.has(candidateIp)) {
          return candidateIp;
        }
      }
    }

    throw new Error('SSTP VPN IP pool (10.200.0.0/16) is exhausted');
  }

  /**
   * Generates a unique VPN username and a cryptographically strong random password.
   */
  generateVpnCredentials(routerId?: string): { username: string; passwordPlain: string } {
    const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    const username = routerId
      ? `rtr_${routerId.replace(/-/g, '').slice(0, 6)}_${randomSuffix}`
      : `rtr_${randomSuffix}`;

    // 16-character secure random password with mixed cases, numbers, and symbol
    const baseBytes = crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, 'X');
    const passwordPlain = `Vpn!${baseBytes.slice(0, 10)}${crypto.randomInt(10, 99)}#`;

    return { username, passwordPlain };
  }

  /**
   * Builds the complete version-tailored MikroTik CLI configuration script.
   */
  generateMikrotikScript(params: {
    routerName: string;
    vpnIp: string;
    vpnUsername: string;
    vpnPasswordPlain: string;
    sstpServerHost?: string;
    sstpServerPort?: number;
    apiServerHost?: string;
    apiServerPort?: number;
    radiusServerIp?: string;
    radiusSecret?: string;
    version?: 'v6' | 'v7';
  }): SstpConfigResult {
    const sstpServerHost = params.sstpServerHost || process.env.SSTP_SERVER_HOST || 'vpn.ispcrm.com';
    const sstpServerPort = params.sstpServerPort || 443;
    const apiServerHost = params.apiServerHost || process.env.API_SERVER_HOST || '172.18.23.172';
    const apiServerPort = params.apiServerPort || Number(process.env.PORT) || 4000;
    const radiusServerIp = params.radiusServerIp || process.env.RADIUS_SERVER_IP || '10.200.0.1';
    const radiusSecret = params.radiusSecret || crypto.randomBytes(16).toString('hex');
    const version = params.version || 'v7';

    let script = '';

    if (version === 'v6') {
      script = [
        '# ======================================================================',
        `# MikroTik RouterOS v6 — Secure SSTP Tunnel & Management Configuration`,
        `# Generated for Router: "${params.routerName}"`,
        `# Assigned Private VPN IP: ${params.vpnIp}`,
        '# ======================================================================',
        '',
        '# 1. Fetch & Trust Central Root CA Certificate (Strict TLS Validation)',
        `/tool fetch url="http://${apiServerHost}:${apiServerPort}/api/routers/ca.crt" dst-path="ispcrm-ca.crt"`,
        ':delay 2s',
        '/certificate import file-name="ispcrm-ca.crt" passphrase=""',
        ':delay 1s',
        '/certificate set [find name~"ispcrm-ca"] trusted=yes',
        '',
        '# 2. Add SSTP Client Interface (Connects Outbound to SaaS VPN Concentrator)',
        `/interface sstp-client add name="sstp-ispcrm" connect-to="${sstpServerHost}" port=${sstpServerPort} user="${params.vpnUsername}" password="${params.vpnPasswordPlain}" profile="default-encryption" verify-server-certificate=yes add-default-route=no comment="ISP CRM Secure Management Tunnel" disabled=no`,
        '',
        '# 3. Enable Legacy Binary API Service (Restricted to Private VPN Subnet)',
        '/ip service enable api',
        '/ip service set api port=8728 address=10.200.0.0/16',
        '',
        '# 4. Configure FreeRADIUS AAA via Private VPN Gateway',
        `/radius add service=ppp address=${radiusServerIp} secret="${radiusSecret}" authentication-port=1812 accounting-port=1813 timeout=3s comment="ISP CRM FreeRADIUS"`,
        '/radius incoming set accept=yes port=3799',
        '',
        '# 5. Configure PPP Profile for RADIUS Authorization',
        '/ppp profile add name="ispcrm-profile" use-radius=yes only-one=yes',
        '',
        '# 6. Firewall Rules: Allow incoming CoA/PoD and Binary API over SSTP tunnel',
        '/ip firewall filter add chain=input in-interface=sstp-ispcrm protocol=udp port=3799 action=accept comment="Allow RADIUS CoA/PoD from ISP CRM"',
        '/ip firewall filter add chain=input in-interface=sstp-ispcrm protocol=tcp port=8728 action=accept comment="Allow RouterOS Binary API from ISP CRM"',
      ].join('\n');
    } else {
      script = [
        '# ======================================================================',
        `# MikroTik RouterOS v7 — Secure SSTP Tunnel & REST API Configuration`,
        `# Generated for Router: "${params.routerName}"`,
        `# Assigned Private VPN IP: ${params.vpnIp}`,
        '# ======================================================================',
        '',
        '# 1. Fetch & Trust Central Root CA Certificate (Strict TLS Validation)',
        `/tool fetch url="http://${apiServerHost}:${apiServerPort}/api/routers/ca.crt" dst-path="ispcrm-ca.crt"`,
        ':delay 2s',
        '/certificate import file-name="ispcrm-ca.crt" passphrase=""',
        ':delay 1s',
        '/certificate set [find name~"ispcrm-ca"] trusted=yes',
        '',
        '# 2. Add SSTP Client Interface (Connects Outbound to SaaS VPN Concentrator)',
        `/interface sstp-client add name="sstp-ispcrm" connect-to="${sstpServerHost}" port=${sstpServerPort} user="${params.vpnUsername}" password="${params.vpnPasswordPlain}" profile="default-encryption" verify-server-certificate=yes add-default-route=no comment="ISP CRM Secure Management Tunnel" disabled=no`,
        '',
        '# 3. Enable Native RouterOS v7 REST API (Restricted to Private VPN Subnet)',
        '/ip service enable www',
        '/ip service set www port=80 address=10.200.0.0/16',
        '',
        '# 4. Configure FreeRADIUS AAA via Private VPN Gateway',
        `/radius add service=ppp address=${radiusServerIp} secret="${radiusSecret}" authentication-port=1812 accounting-port=1813 timeout=3s comment="ISP CRM FreeRADIUS"`,
        '/radius incoming set accept=yes port=3799',
        '',
        '# 5. Configure PPP Profile for RADIUS Authorization',
        '/ppp profile add name="ispcrm-profile" use-radius=yes only-one=yes',
        '',
        '# 6. Firewall Rules: Allow incoming CoA/PoD and REST API over SSTP tunnel',
        '/ip firewall filter add chain=input in-interface=sstp-ispcrm protocol=udp port=3799 action=accept comment="Allow RADIUS CoA/PoD from ISP CRM"',
        '/ip firewall filter add chain=input in-interface=sstp-ispcrm protocol=tcp port=80 action=accept comment="Allow RouterOS REST API from ISP CRM"',
      ].join('\n');
    }

    return {
      routerId: '',
      routerName: params.routerName,
      vpnIp: params.vpnIp,
      vpnUsername: params.vpnUsername,
      vpnPasswordPlain: params.vpnPasswordPlain,
      sstpServerHost,
      sstpServerPort,
      radiusServerIp,
      radiusSecret,
      routerOsVersion: version,
      script,
    };
  }
}
