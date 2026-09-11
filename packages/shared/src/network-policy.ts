import { SpeedUnit } from './enums';

/**
 * Vendor-Neutral Network Policy Object Abstraction
 * Represents bandwidth allocation, burst profiles, and traffic shaping policies
 * without tying client applications or business logic to RouterOS or vendor-specific syntax.
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
  };
  fup?: {
    enabled: boolean;
    dataLimitGb?: number;
    fupDownloadSpeed?: number;
    fupUploadSpeed?: number;
  };
  qosPriority: number; // 1 (highest) to 8 (lowest/standard)
}

/**
 * RADIUS Translated Attributes Dictionary
 * Ready to be stored in `radreply` table or injected into RFC 2865 / RFC 3576 RADIUS packets
 */
export interface RadiusPolicyAttributes {
  'Mikrotik-Rate-Limit': string;
  'WISPr-Bandwidth-Max-Down': number;
  'WISPr-Bandwidth-Max-Up': number;
  'Filter-Id'?: string;
  [key: string]: string | number | undefined;
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
 * Construct a vendor-neutral NetworkPolicy from an InternetPlan entity
 */
export function buildNetworkPolicyFromPlan(plan: {
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
}): NetworkPolicy {
  const unit = (plan.speedUnit as SpeedUnit) || SpeedUnit.MBPS;
  const download = Number(plan.downloadSpeed || plan.downloadSpeedMbps || 0);
  const upload = Number(plan.uploadSpeed || plan.uploadSpeedMbps || 0);

  const downloadBps = convertSpeedToBps(download, unit);
  const uploadBps = convertSpeedToBps(upload, unit);

  const hasBurst = Boolean(
    plan.burstDownloadMbps &&
    plan.burstUploadMbps &&
    plan.burstThresholdMbps &&
    plan.burstTimeSecs,
  );

  const hasFup = Boolean(plan.dataLimitGb && plan.dataLimitGb > 0);

  return {
    policyName: plan.code || plan.name,
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
        }
      : { enabled: false },
    fup: hasFup
      ? {
          enabled: true,
          dataLimitGb: Number(plan.dataLimitGb),
          fupDownloadSpeed: plan.fupDownloadSpeedMbps ? Number(plan.fupDownloadSpeedMbps) : undefined,
          fupUploadSpeed: plan.fupUploadSpeedMbps ? Number(plan.fupUploadSpeedMbps) : undefined,
        }
      : { enabled: false },
    qosPriority: 8,
  };
}

/**
 * Translates a vendor-neutral NetworkPolicy into RADIUS & MikroTik attributes.
 *
 * Syntax: [rx/tx] [rx-burst/tx-burst] [rx-threshold/tx-threshold] [burst-time] [priority]
 * Note:
 * - rx is client upload (ingress to router)
 * - tx is client download (egress from router)
 */
export function translateNetworkPolicyToRadius(policy: NetworkPolicy): RadiusPolicyAttributes {
  const { rateLimit, burst, qosPriority } = policy;
  const unit = rateLimit.unit;

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

  return {
    'Mikrotik-Rate-Limit': mikrotikRateLimit,
    'WISPr-Bandwidth-Max-Down': rateLimit.downloadSpeedBps,
    'WISPr-Bandwidth-Max-Up': rateLimit.uploadSpeedBps,
  };
}
