import { z } from 'zod';
import {
  UserRole,
  CustomerStatus,
  SubscriptionStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  RouterStatus,
  PlanStatus,
  BillingCycle,
  SpeedUnit,
} from './enums';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(10),
});

export const RegisterOrganizationSchema = z.object({
  // Organization Info
  name: z.string().min(2, 'Organization name must be at least 2 characters'),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase alphanumeric characters and hyphens'),
  legalName: z.string().optional(),
  gstin: z.string().length(15, 'GSTIN must be exactly 15 characters').optional(),
  email: z.string().email('Valid organization contact email required'),
  phone: z.string().min(10, 'Valid phone number required'),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  stateCode: z.string().length(2).optional(),
  pincode: z.string().optional(),

  // First Admin User (ISP_OWNER)
  ownerName: z.string().min(2, 'Owner name must be at least 2 characters'),
  ownerEmail: z.string().email('Valid owner email required'),
  ownerPassword: z.string().min(6, 'Password must be at least 6 characters'),
  ownerPhone: z.string().min(10).optional(),
});

export const CreateAdminUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional(),
  role: z.nativeEnum(UserRole).default(UserRole.SUPPORT),
});

export const CreateCustomerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  customerCode: z.string().min(2, 'Customer code required'),
  mobile: z.string().min(10, 'Valid 10-digit mobile number required'),
  phone: z.string().optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  address: z.string().min(3, 'Address is required'),
  installationAddress: z.string().optional(),
  area: z.string().optional().or(z.literal('')),
  city: z.string().optional().or(z.literal('')),
  state: z.string().optional().or(z.literal('')),
  pincode: z.string().optional().or(z.literal('')),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Alphanumeric, dot, underscore, and dash only'),
  pppoeUsername: z.string().optional(),
  pppoePassword: z.string().min(4, 'Password must be at least 4 characters').default('123456'),
  status: z.nativeEnum(CustomerStatus).default(CustomerStatus.LEAD),
  installationDate: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  staticIp: z.string().ip().optional().or(z.literal('')),
  planId: z.string().uuid().optional().or(z.literal('')),
});

export const UpdateCustomerSchema = z.object({
  name: z.string().min(2).optional(),
  customerCode: z.string().min(2).optional(),
  mobile: z.string().min(10).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().min(3).optional(),
  installationAddress: z.string().optional(),
  area: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  username: z
    .string()
    .min(3)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .optional(),
  pppoePassword: z.string().min(4).optional(),
  status: z.nativeEnum(CustomerStatus).optional(),
  installationDate: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  staticIp: z.string().ip().optional().or(z.literal('')),
  planId: z.string().uuid().optional().or(z.literal('')),
});

export const CustomerPaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  status: z.string().optional(),
  area: z.string().optional(),
  city: z.string().optional(),
});

export const CreateInternetPlanSchema = z.object({
  name: z.string().min(2, 'Plan name must be at least 2 characters'),
  code: z.string().optional(),
  description: z.string().optional().nullable(),
  downloadSpeed: z.coerce.number().positive().optional(),
  uploadSpeed: z.coerce.number().positive().optional(),
  downloadSpeedMbps: z.coerce.number().int().positive().optional(),
  uploadSpeedMbps: z.coerce.number().int().positive().optional(),
  speedUnit: z.nativeEnum(SpeedUnit).default(SpeedUnit.MBPS),
  validityDays: z.coerce.number().int().positive().default(30),
  billingCycle: z.nativeEnum(BillingCycle).default(BillingCycle.MONTHLY),
  price: z.coerce.number().positive('Price must be positive'),
  status: z.nativeEnum(PlanStatus).default(PlanStatus.ACTIVE),
  gstRatePercent: z.coerce.number().nonnegative().default(18.0),
  dataLimitGb: z.coerce.number().int().positive().optional().nullable(),
  burstDownloadMbps: z.coerce.number().int().positive().optional().nullable(),
  burstUploadMbps: z.coerce.number().int().positive().optional().nullable(),
  burstThresholdMbps: z.coerce.number().int().positive().optional().nullable(),
  burstTimeSecs: z.coerce.number().int().positive().optional().nullable(),
});

export const UpdateInternetPlanSchema = CreateInternetPlanSchema.partial();

export const CreateSubscriptionSchema = z.object({
  customerId: z.string().uuid('Valid customer ID required'),
  planId: z.string().uuid('Valid plan ID required'),
  startDate: z.string().optional(),
  status: z.nativeEnum(SubscriptionStatus).optional(),
  billingCycle: z.nativeEnum(BillingCycle).optional(),
  price: z.coerce.number().optional(),
  autoRenew: z.boolean().default(true),
  gracePeriodDays: z.coerce.number().int().nonnegative().default(3),
});

export const RenewSubscriptionSchema = z.object({
  validityDays: z.number().int().positive().optional(),
});

export const CreateMikrotikRouterSchema = z.object({
  name: z.string().min(2),
  ipAddress: z.string().ip(),
  radiusSecret: z.string().min(4),
  apiPort: z.number().int().positive().default(8728),
  coaPort: z.number().int().positive().default(3799),
  apiUsername: z.string().optional(),
  apiPassword: z.string().optional(),
});

export const CreateInvoiceItemSchema = z.object({
  description: z.string().min(1, 'Item description is required'),
  sacCode: z.string().default('998422'),
  quantity: z.number().int().min(1).default(1),
  unitPrice: z.union([z.number().positive(), z.string()]),
  discountAmount: z.union([z.number().min(0), z.string()]).default(0),
  taxRatePercent: z.union([z.number().min(0), z.string()]).default(18.0),
});

export const CreateInvoiceSchema = z.object({
  customerId: z.string().uuid('Valid customer ID is required'),
  subscriptionId: z.string().uuid().optional(),
  dueDate: z.string().optional(),
  status: z.nativeEnum(InvoiceStatus).default(InvoiceStatus.ISSUED),
  discountAmount: z.union([z.number().min(0), z.string()]).default(0),
  notes: z.string().optional(),
  items: z.array(CreateInvoiceItemSchema).min(1, 'At least one invoice item is required'),
});

export const RecordPaymentSchema = z.object({
  customerId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  amount: z.union([z.number().positive(), z.string()]),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  transactionRef: z.string().optional(),
  notes: z.string().optional(),
});

export const CreatePaymentIntentSchema = z.object({
  invoiceId: z.string().uuid('Valid invoice ID required'),
  amount: z.union([z.number().positive(), z.string()]).optional(),
});

export const VerifyOnlinePaymentSchema = z.object({
  invoiceId: z.string().uuid('Valid invoice ID required'),
  gatewayOrderId: z.string().min(1, 'Gateway order ID required'),
  gatewayPaymentId: z.string().min(1, 'Gateway payment ID required'),
  signature: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export const RefundPaymentSchema = z.object({
  amount: z.union([z.number().positive(), z.string()]).optional(),
  reason: z.string().optional(),
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;
export type RegisterOrganizationInput = z.infer<typeof RegisterOrganizationSchema>;
export type CreateAdminUserInput = z.infer<typeof CreateAdminUserSchema>;
export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
export type CustomerPaginationInput = z.infer<typeof CustomerPaginationSchema>;
export type CreateInternetPlanInput = z.infer<typeof CreateInternetPlanSchema>;
export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionSchema>;
export type RenewSubscriptionInput = z.infer<typeof RenewSubscriptionSchema>;
export type CreateMikrotikRouterInput = z.infer<typeof CreateMikrotikRouterSchema>;
export type CreateInvoiceItemInput = z.infer<typeof CreateInvoiceItemSchema>;
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;
export type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;
export type CreatePaymentIntentInput = z.infer<typeof CreatePaymentIntentSchema>;
export type VerifyOnlinePaymentInput = z.infer<typeof VerifyOnlinePaymentSchema>;
export type RefundPaymentInput = z.infer<typeof RefundPaymentSchema>;

/**
 * MikroTik RouterOS Rate-Limit String Generator
 * Syntax: [rx/tx] [rx-burst/tx-burst] [rx-threshold/tx-threshold] [burst-time] [priority]
 * In RouterOS:
 * - rx is client upload (ingress to router)
 * - tx is client download (egress from router)
 */
export function generateMikrotikRateLimit(plan: {
  downloadSpeedMbps: number;
  uploadSpeedMbps: number;
  burstDownloadMbps?: number | null;
  burstUploadMbps?: number | null;
  burstThresholdMbps?: number | null;
  burstTimeSecs?: number | null;
}): string {
  const baseRate = `${plan.uploadSpeedMbps}M/${plan.downloadSpeedMbps}M`;
  if (
    plan.burstUploadMbps &&
    plan.burstDownloadMbps &&
    plan.burstThresholdMbps &&
    plan.burstTimeSecs
  ) {
    const burstRate = `${plan.burstUploadMbps}M/${plan.burstDownloadMbps}M`;
    const threshold = `${plan.burstThresholdMbps}M/${plan.burstThresholdMbps}M`;
    const burstTime = `${plan.burstTimeSecs}/${plan.burstTimeSecs}`;
    return `${baseRate} ${burstRate} ${threshold} ${burstTime} 8`;
  }
  return baseRate;
}
