import {
  UserRole,
  CustomerStatus,
  SubscriptionStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  RouterStatus,
  AuditAction,
} from './enums';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    statusCode: number;
    error?: string;
    message: string;
    details?: any[];
  };
  meta?: {
    timestamp: string;
    requestId?: string;
    path?: string;
    [key: string]: any;
  };
}

export interface PaginatedMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: PaginatedMeta;
}

export interface HealthCheckResponse {
  status: 'ok' | 'error' | 'shutting_down' | 'degraded';
  info?: Record<string, { status: 'up' | 'down'; message?: string }>;
  error?: Record<string, { status: 'up' | 'down'; message?: string }>;
  details?: Record<string, any>;
}

export interface TenantContext {
  userId: string;
  organizationId: string;
  email: string;
  role: UserRole;
  name?: string;
  orgSlug?: string;
}

export interface JwtPayload {
  sub: string; // userId
  organizationId: string;
  email: string;
  role: UserRole;
  orgSlug?: string;
  iat?: number;
  exp?: number;
}

export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    organizationId: string;
    organizationName: string;
  };
}

export interface ActiveRadiusSessionDto {
  radacctid: string;
  acctsessionid: string;
  username: string;
  nasipaddress: string;
  callingstationid: string;
  framedipaddress: string;
  acctstarttime: string;
  acctsessiontime: number;
  downloadBytes: number;
  uploadBytes: number;
}

export interface CustomerDto {
  id: string;
  organizationId: string;
  customerCode: string;
  name: string;
  mobile: string;
  phone?: string | null;
  email?: string | null;
  alternatePhone?: string | null;
  address: string;
  installationAddress?: string | null;
  area?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  username: string;
  pppoeUsername?: string | null;
  staticIp?: string | null;
  macAddress?: string | null;
  status: CustomerStatus;
  installationDate?: string | Date | null;
  notes?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  subscriptions?: any[];
}

export interface CreateCustomerDto {
  name: string;
  customerCode: string;
  mobile: string;
  phone?: string;
  email?: string;
  address: string;
  installationAddress?: string;
  area?: string;
  city?: string;
  state?: string;
  pincode?: string;
  username: string;
  pppoeUsername?: string;
  pppoePassword?: string;
  status?: CustomerStatus;
  installationDate?: string;
  notes?: string;
  staticIp?: string;
  macAddress?: string | null;
  planId?: string;
}

export interface UpdateCustomerDto {
  name?: string;
  customerCode?: string;
  mobile?: string;
  phone?: string;
  email?: string;
  address?: string;
  installationAddress?: string;
  area?: string;
  city?: string;
  state?: string;
  pincode?: string;
  username?: string;
  pppoePassword?: string;
  status?: CustomerStatus;
  installationDate?: string;
  notes?: string;
  staticIp?: string;
  macAddress?: string | null;
  planId?: string;
}

