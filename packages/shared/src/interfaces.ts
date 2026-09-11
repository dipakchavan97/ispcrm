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
