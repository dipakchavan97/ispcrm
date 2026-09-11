import { SpeedUnit } from './enums';

/**
 * Tier 1: Commercial / Business Internet Plan Input
 * Represents business/subscriber tier specifications before network policy translation.
 */
export interface PlanInput {
  name: string;
  code?: string;
  downloadSpeed?: number | string | any;
  uploadSpeed?: number | string | any;
  downloadSpeedMbps?: number | null;
  uploadSpeedMbps?: number | null;
  speedUnit?: SpeedUnit | string | null;
  dataLimitGb?: number | null;
  fupDownloadSpeedMbps?: number | null;
  fupUploadSpeedMbps?: number | null;
  burstDownloadMbps?: number | null;
  burstUploadMbps?: number | null;
  burstThresholdMbps?: number | null;
  burstTimeSecs?: number | null;
  priority?: number | null;
  poolName?: string | null;
  staticIp?: string | null;
}

/**
 * Tier 2: Vendor-Neutral Network Policy Object Abstraction
 * Represents QoS, bandwidth shaping, burst curves, and FUP quotas
 * without coupling client applications to RouterOS, Cisco, or FreeRADIUS vendor syntax.
 */
export interface NetworkPolicy {
  policyName: string;
  rateLimit: {
    downloadSpeed: number;
    uploadSpeed: number;
    unit: SpeedUnit;
    downloadSpeedBps: number;
    uploadSpeedBps: number;
  };
  burst?: {
    enabled: boolean;
    burstDownloadSpeed?: number;
    burstUploadSpeed?: number;
    threshold?: number;
    durationSecs?: number;
    burstDownloadSpeedBps?: number;
    burstUploadSpeedBps?: number;
  };
  fup?: {
    enabled: boolean;
    dataLimitGb?: number;
    dataLimitBytes?: number;
    fupDownloadSpeed?: number;
    fupUploadSpeed?: number;
    fupDownloadSpeedBps?: number;
    fupUploadSpeedBps?: number;
  };
  qosPriority: number; // 1 (highest) to 8 (lowest/standard)
  ipAllocation?: {
    poolName?: string;
    staticIp?: string;
  };
}

/**
 * Tier 3: RADIUS & MikroTik Authorization Policy Dictionary
 * Concrete vendor attributes ready for FreeRADIUS `radreply` insertion or Access-Accept packet transmission.
 */
export interface RadiusAttributes {
  'Mikrotik-Rate-Limit': string;
  'WISPr-Bandwidth-Max-Down': number;
  'WISPr-Bandwidth-Max-Up': number;
  'Framed-Protocol'?: string;
  'Service-Type'?: string;
  'Ascend-Data-Rate'?: number;
  'Ascend-Xmit-Rate'?: number;
  'Framed-Pool'?: string;
  'Framed-IP-Address'?: string;
  'Filter-Id'?: string;
  'Mikrotik-Group'?: string;
  [key: string]: string | number | undefined;
}

/**
 * Backwards compatibility alias
 */
export type RadiusPolicyAttributes = RadiusAttributes;

/**
 * FreeRADIUS radreply SQL entity format
 */
export interface RadReplyEntry {
  username: string;
  attribute: string;
  op: string;
  value: string;
}

/**
 * Helper to convert speed to bits-per-second (Bps)
 */
export function convertSpeedToBps(speed: number, unit: SpeedUnit): number {
  switch (unit) {
    case SpeedUnit.KBPS:
      return Math.round(speed * 1_000);
    case SpeedUnit.GBPS:
      return Math.round(speed * 1_000_000_000);
    case SpeedUnit.MBPS:
    default:
      return Math.round(speed * 1_000_000);
  }
}

/**
 * Helper to format speed string for MikroTik rate-limit (e.g., "50M", "512k", "1G")
 */
export function formatSpeedForMikrotik(speed: number, unit: SpeedUnit): string {
  switch (unit) {
    case SpeedUnit.KBPS:
      return `${speed}k`;
    case SpeedUnit.GBPS:
      return `${speed}G`;
    case SpeedUnit.MBPS:
    default:
      return `${speed}M`;
  }
}

/**
 * Step 1: Construct a vendor-neutral NetworkPolicy from a Plan
 */
export function buildNetworkPolicyFromPlan(plan: PlanInput): NetworkPolicy {
  const unit = (plan.speedUnit as SpeedUnit) || SpeedUnit.MBPS;
  const download = Number(plan.downloadSpeed !== undefined ? plan.downloadSpeed : (plan.downloadSpeedMbps || 0));
  const upload = Number(plan.uploadSpeed !== undefined ? plan.uploadSpeed : (plan.uploadSpeedMbps || 0));

  const downloadBps = convertSpeedToBps(download, unit);
  const uploadBps = convertSpeedToBps(upload, unit);

  const hasBurst = Boolean(
    plan.burstDownloadMbps &&
    plan.burstUploadMbps &&
    plan.burstThresholdMbps &&
    plan.burstTimeSecs,
  );

  const hasFup = Boolean(plan.dataLimitGb && Number(plan.dataLimitGb) > 0);

  return {
    policyName: plan.code || plan.name || `plan-${download}m-${upload}m`,
    rateLimit: {
      downloadSpeed: download,
      uploadSpeed: upload,
      unit,
      downloadSpeedBps: downloadBps,
      uploadSpeedBps: uploadBps,
    },
    burst: hasBurst
      ? {
          enabled: true,
          burstDownloadSpeed: Number(plan.burstDownloadMbps),
          burstUploadSpeed: Number(plan.burstUploadMbps),
          threshold: Number(plan.burstThresholdMbps),
          durationSecs: Number(plan.burstTimeSecs),
          burstDownloadSpeedBps: convertSpeedToBps(Number(plan.burstDownloadMbps), unit),
          burstUploadSpeedBps: convertSpeedToBps(Number(plan.burstUploadMbps), unit),
        }
      : { enabled: false },
    fup: hasFup
      ? {
          enabled: true,
          dataLimitGb: Number(plan.dataLimitGb),
          dataLimitBytes: Number(plan.dataLimitGb) * 1024 * 1024 * 1024,
          fupDownloadSpeed: plan.fupDownloadSpeedMbps ? Number(plan.fupDownloadSpeedMbps) : undefined,
          fupUploadSpeed: plan.fupUploadSpeedMbps ? Number(plan.fupUploadSpeedMbps) : undefined,
          fupDownloadSpeedBps: plan.fupDownloadSpeedMbps ? convertSpeedToBps(Number(plan.fupDownloadSpeedMbps), unit) : undefined,
          fupUploadSpeedBps: plan.fupUploadSpeedMbps ? convertSpeedToBps(Number(plan.fupUploadSpeedMbps), unit) : undefined,
        }
      : { enabled: false },
    qosPriority: plan.priority ? Number(plan.priority) : 8,
    ipAllocation: (plan.poolName || plan.staticIp) ? {
      poolName: plan.poolName || undefined,
      staticIp: plan.staticIp || undefined,
    } : undefined,
  };
}

/**
 * Step 2: Translates a vendor-neutral NetworkPolicy into RADIUS & MikroTik attributes.
 *
 * MikroTik Rate Limit Syntax:
 * [rx-rate/tx-rate] [rx-burst/tx-burst] [rx-threshold/tx-threshold] [burst-time] [priority]
 * Note:
 * - rx is client upload (ingress to router from subscriber)
 * - tx is client download (egress from router to subscriber)
 */
export function translateNetworkPolicyToRadius(policy: NetworkPolicy): RadiusAttributes {
  const { rateLimit, burst, qosPriority, ipAllocation } = policy;
  const unit = rateLimit.unit;

  // MikroTik format: upload (rx) / download (tx)
  const uploadStr = formatSpeedForMikrotik(rateLimit.uploadSpeed, unit);
  const downloadStr = formatSpeedForMikrotik(rateLimit.downloadSpeed, unit);
  const baseRate = `${uploadStr}/${downloadStr}`;

  let mikrotikRateLimit = baseRate;

  if (
    burst &&
    burst.enabled &&
    burst.burstUploadSpeed &&
    burst.burstDownloadSpeed &&
    burst.threshold &&
    burst.durationSecs
  ) {
    const burstUploadStr = formatSpeedForMikrotik(burst.burstUploadSpeed, unit);
    const burstDownloadStr = formatSpeedForMikrotik(burst.burstDownloadSpeed, unit);
    const burstRate = `${burstUploadStr}/${burstDownloadStr}`;

    const thresholdStr = formatSpeedForMikrotik(burst.threshold, unit);
    const thresholdRate = `${thresholdStr}/${thresholdStr}`;

    const duration = `${burst.durationSecs}/${burst.durationSecs}`;
    mikrotikRateLimit = `${baseRate} ${burstRate} ${thresholdRate} ${duration} ${qosPriority || 8}`;
  }

  const attrs: RadiusAttributes = {
    'Mikrotik-Rate-Limit': mikrotikRateLimit,
    'WISPr-Bandwidth-Max-Down': rateLimit.downloadSpeedBps,
    'WISPr-Bandwidth-Max-Up': rateLimit.uploadSpeedBps,
    'Framed-Protocol': 'PPP',
    'Service-Type': 'Framed-User',
    'Ascend-Data-Rate': rateLimit.downloadSpeedBps,
    'Ascend-Xmit-Rate': rateLimit.uploadSpeedBps,
  };

  if (ipAllocation?.poolName) {
    attrs['Framed-Pool'] = ipAllocation.poolName;
  }
  if (ipAllocation?.staticIp) {
    attrs['Framed-IP-Address'] = ipAllocation.staticIp;
  }

  return attrs;
}

/**
 * 3-Tier Clean Abstraction Pipeline:
 * Plan -> NetworkPolicy -> RadiusAttributes
 */
export class NetworkPolicyGenerator {
  /**
   * Tier 1 -> Tier 2:
   * Transforms a commercial Plan into a vendor-neutral NetworkPolicy.
   */
  static fromPlan(plan: PlanInput): NetworkPolicy {
    return buildNetworkPolicyFromPlan(plan);
  }

  /**
   * Tier 2 -> Tier 3:
   * Translates a vendor-neutral NetworkPolicy into concrete RADIUS & MikroTik authorization attributes.
   */
  static toRadiusAttributes(policy: NetworkPolicy): RadiusAttributes {
    return translateNetworkPolicyToRadius(policy);
  }

  /**
   * Complete 3-Tier Pipeline Execution:
   * Plan -> NetworkPolicy -> RadiusAttributes
   */
  static generate(plan: PlanInput): {
    plan: PlanInput;
    networkPolicy: NetworkPolicy;
    radiusAttributes: RadiusAttributes;
  } {
    const networkPolicy = this.fromPlan(plan);
    const radiusAttributes = this.toRadiusAttributes(networkPolicy);
    return {
      plan,
      networkPolicy,
      radiusAttributes,
    };
  }

  /**
   * Converts RadiusAttributes into database records for the FreeRADIUS `radreply` table.
   */
  static toRadReplyEntries(attributes: RadiusAttributes, username: string): RadReplyEntry[] {
    const entries: RadReplyEntry[] = [];
    for (const [key, val] of Object.entries(attributes)) {
      if (val !== undefined && val !== null) {
        entries.push({
          username,
          attribute: key,
          op: ':=',
          value: String(val),
        });
      }
    }
    return entries;
  }

  /**
   * Generates a MikroTik RouterOS simple queue CLI command.
   * e.g. /queue simple add name="plan-100m" max-limit=50M/100M target=192.168.1.50/32
   */
  static toMikrotikSimpleQueueCommand(
    policy: NetworkPolicy,
    target: string,
    queueName?: string,
  ): string {
    const radius = this.toRadiusAttributes(policy);
    const rateLimit = radius['Mikrotik-Rate-Limit'];
    const name = queueName || `queue-${policy.policyName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    return `/queue simple add name="${name}" max-limit=${rateLimit} target=${target} priority=${policy.qosPriority}/${policy.qosPriority}`;
  }
}
