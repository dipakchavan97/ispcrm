export const DEFAULT_GST_RATE = 18.0;
export const TELECOM_SAC_CODE = '998422'; // Internet telecommunication services
export const DEFAULT_CURRENCY = 'INR';
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export const RADIUS_PORTS = {
  AUTH: 1812,
  ACCT: 1813,
  COA: 3799,
} as const;

export const MIKROTIK_PORTS = {
  API: 8728,
  API_SSL: 8729,
  COA: 3799,
} as const;

export const QUEUE_NAMES = {
  BILLING: 'billing-queue',
  RADIUS_COA: 'radius-coa-queue',
  ROUTER_SYNC: 'router-sync-queue',
} as const;
