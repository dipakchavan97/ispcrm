export interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  meta?: any;
  error?: {
    statusCode: number;
    message: string;
    error?: string;
  };
}

let memoryToken: string | null = null;

export function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || '/api';
}

export function getAuthToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('ispcrm_token') || memoryToken;
  }
  return memoryToken;
}

export function setAuthToken(token: string) {
  memoryToken = token;
  if (typeof window !== 'undefined') {
    localStorage.setItem('ispcrm_token', token);
  }
}

export function clearAuthToken() {
  memoryToken = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem('ispcrm_token');
  }
}

/**
 * Redirect to login if unauthenticated or session expired
 */
export function redirectToLogin() {
  clearAuthToken();
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

export async function apiFetch<T = any>(
  endpoint: string,
  options: RequestInit = {},
  retryCount = 0,
): Promise<T> {
  const token = getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const apiBase = getApiBase();
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${apiBase}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch (netErr: any) {
    throw new Error(`Network connection error: ${netErr.message || 'Unable to connect to ISP CRM API'}`);
  }

  // Handle 401 Unauthorized (expired or invalid token)
  if (response.status === 401) {
    redirectToLogin();
    throw new Error('Session expired or unauthorized. Please log in again.');
  }

  let json: ApiResponse<T>;
  try {
    json = await response.json();
  } catch (e) {
    if (!response.ok) {
      throw new Error(`API error (${response.status}): ${response.statusText}`);
    }
    return {} as T;
  }

  if (!response.ok || json.success === false) {
    const errorMsg = json.error?.message || response.statusText || 'API request failed';
    throw new Error(errorMsg);
  }

  return json.data !== undefined ? json.data : (json as unknown as T);
}

/**
 * Fetch invoice PDF as a Blob using authenticated Bearer token and validate integrity.
 */
async function fetchInvoicePdfBlob(invoiceId: string, preview = false): Promise<Blob> {
  const token = getAuthToken();
  if (!token) {
    redirectToLogin();
    throw new Error('Authentication required. Please log in again.');
  }

  const headers: Record<string, string> = {
    Accept: 'application/pdf',
    Authorization: `Bearer ${token}`,
  };

  const orgId = typeof window !== 'undefined' ? localStorage.getItem('currentOrgId') || '' : '';
  if (orgId) {
    headers['x-organization-id'] = orgId;
  }

  const apiBase = getApiBase();
  const url = `${apiBase}/invoices/${encodeURIComponent(invoiceId)}/pdf${preview ? '?preview=true' : ''}`;

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (err: any) {
    throw new Error(`Network error connecting to invoice PDF server: ${err.message || 'Unable to connect'}`);
  }

  if (response.status === 401) {
    redirectToLogin();
    throw new Error('Session expired or unauthorized. Please log in again.');
  }

  if (!response.ok) {
    let errorMsg = `Failed to generate PDF on server (HTTP ${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) {
        errorMsg = errJson.error.message;
      } else if (errJson?.message) {
        errorMsg = errJson.message;
      }
    } catch {
      // Not JSON, ignore
    }
    throw new Error(errorMsg);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/pdf')) {
    throw new Error(`Invalid response format from server: expected application/pdf, received ${contentType || 'unknown'}`);
  }

  const blob = await response.blob();

  // Validate PDF magic bytes (%PDF- : 0x25, 0x50, 0x44, 0x46, 0x2d)
  const magicBytes = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  const isPdf =
    magicBytes.length >= 5 &&
    magicBytes[0] === 0x25 &&
    magicBytes[1] === 0x50 &&
    magicBytes[2] === 0x44 &&
    magicBytes[3] === 0x46 &&
    magicBytes[4] === 0x2d;

  if (!isPdf) {
    throw new Error('Server returned corrupted or invalid PDF data (missing %PDF- header).');
  }

  return blob;
}

/**
 * Download invoice PDF with authenticated Bearer token and proper filename.
 */
export async function downloadInvoicePdf(invoiceId: string, invoiceNumber: string): Promise<void> {
  if (typeof window === 'undefined') return;

  const blob = await fetchInvoicePdfBlob(invoiceId, false);
  const blobUrl = window.URL.createObjectURL(blob);

  try {
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    // Sanitize filename
    const safeInvNum = (invoiceNumber || invoiceId).replace(/[^a-zA-Z0-9-_]/g, '_');
    a.download = `INVOICE-${safeInvNum}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Keep alive for 60 seconds to ensure mobile browsers (Android Chrome, iOS Safari) finish saving
    setTimeout(() => {
      try {
        window.URL.revokeObjectURL(blobUrl);
      } catch {}
    }, 60000);
  }
}

/**
 * Open the generated A4 vector PDF in a new browser tab for preview.
 * Uses the browser's native vector PDF viewer.
 */
export async function previewInvoicePdf(invoiceId: string): Promise<void> {
  if (typeof window === 'undefined') return;

  const blob = await fetchInvoicePdfBlob(invoiceId, true);
  const blobUrl = window.URL.createObjectURL(blob);

  const pdfWindow = window.open(blobUrl, '_blank');
  if (!pdfWindow || pdfWindow.closed || typeof pdfWindow.closed === 'undefined') {
    window.URL.revokeObjectURL(blobUrl);
    throw new Error(
      'Popup blocked: Please allow popups for this site in your browser to view the invoice PDF.'
    );
  }

  try {
    pdfWindow.focus();
  } catch {}

  // Keep the blob URL alive for 3 minutes so the PDF viewer can buffer and render without premature revocation
  setTimeout(() => {
    try {
      window.URL.revokeObjectURL(blobUrl);
    } catch {}
  }, 180000);
}

/**
 * Open the generated A4 vector PDF in a new browser tab for printing.
 * Attempts to trigger the native PDF viewer print dialog if permitted,
 * while ensuring the user can print directly from the opened PDF document.
 * NEVER prints the HTML webpage.
 */
export async function printInvoicePdf(invoiceId: string): Promise<void> {
  if (typeof window === 'undefined') return;

  const blob = await fetchInvoicePdfBlob(invoiceId, true);
  const blobUrl = window.URL.createObjectURL(blob);

  const pdfWindow = window.open(blobUrl, '_blank');
  if (!pdfWindow || pdfWindow.closed || typeof pdfWindow.closed === 'undefined') {
    window.URL.revokeObjectURL(blobUrl);
    throw new Error(
      'Popup blocked: Please allow popups for this site in your browser to print the invoice PDF.'
    );
  }

  // Attempt to trigger print from the opened PDF context if permitted
  try {
    pdfWindow.focus();
    setTimeout(() => {
      try {
        if (!pdfWindow.closed) {
          pdfWindow.print();
        }
      } catch {
        // PDF viewer plugin sandboxing or cross-context restrictions prevent script-driven print;
        // The PDF is loaded and visible in the tab, user uses the viewer's native print button.
      }
    }, 800);
  } catch {
    // Handled gracefully; PDF remains open for user printing
  }

  // Keep the blob URL alive for 3 minutes so the user has ample time to review and print
  setTimeout(() => {
    try {
      window.URL.revokeObjectURL(blobUrl);
    } catch {}
  }, 180000);
}

/**
 * Fetch Customer Application Form (CAF) PDF as a Blob using authenticated Bearer token and validate integrity.
 * @param customerId - Target customer ID
 * @param preview - true for in-browser preview (inline Content-Disposition), false for download (attachment)
 */
export async function fetchCafPdfBlob(customerId: string, preview = false): Promise<Blob> {
  const token = getAuthToken();
  if (!token) {
    redirectToLogin();
    throw new Error('Authentication required. Please log in again.');
  }

  const headers: Record<string, string> = {
    Accept: 'application/pdf',
    Authorization: `Bearer ${token}`,
  };

  const orgId = typeof window !== 'undefined' ? localStorage.getItem('currentOrgId') || '' : '';
  if (orgId) {
    headers['x-organization-id'] = orgId;
  }

  const apiBase = getApiBase();
  const url = `${apiBase}/customers/${encodeURIComponent(customerId)}/caf.pdf?preview=${preview ? '1' : '0'}`;

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (err: any) {
    throw new Error(`Network error connecting to CAF server: ${err.message || 'Unable to connect'}`);
  }

  if (response.status === 401) {
    redirectToLogin();
    throw new Error('Session expired or unauthorized. Please log in again.');
  }

  if (response.status === 403) {
    throw new Error('Access denied. You do not have permission to view or generate this Customer Application Form.');
  }

  if (response.status === 404) {
    throw new Error('Customer or application form not found.');
  }

  if (!response.ok) {
    let errorMsg = `Failed to generate CAF PDF on server (HTTP ${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) {
        errorMsg = errJson.error.message;
      } else if (errJson?.message) {
        errorMsg = errJson.message;
      }
    } catch {
      // Not JSON, ignore
    }
    throw new Error(errorMsg);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/pdf')) {
    throw new Error(`Invalid response format from server: expected application/pdf, received ${contentType || 'unknown'}`);
  }

  const blob = await response.blob();

  // Validate PDF magic bytes (%PDF- : 0x25, 0x50, 0x44, 0x46, 0x2d)
  const magicBytes = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  const isPdf =
    magicBytes.length >= 5 &&
    magicBytes[0] === 0x25 &&
    magicBytes[1] === 0x50 &&
    magicBytes[2] === 0x44 &&
    magicBytes[3] === 0x46 &&
    magicBytes[4] === 0x2d;

  if (!isPdf) {
    throw new Error('Server returned corrupted or invalid PDF data (missing %PDF- header).');
  }

  return blob;
}

/**
 * Download Customer Application Form (CAF) PDF with authenticated Bearer token and safe customer filename.
 * Does NOT place Aadhaar, passwords, secrets, or sensitive tokens in the filename.
 */
export async function downloadCafPdf(
  customerId: string,
  customerCode: string,
  customerName?: string
): Promise<void> {
  if (typeof window === 'undefined') return;

  const blob = await fetchCafPdfBlob(customerId, false);
  const blobUrl = window.URL.createObjectURL(blob);

  try {
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    // Sanitize filename using only safe identifiers
    const safeCode = (customerCode || customerId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeName = customerName
      ? customerName
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .substring(0, 30)
      : '';
    a.download = safeName ? `CAF-${safeCode}-${safeName}.pdf` : `CAF-${safeCode}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Keep alive for 60 seconds to ensure mobile and desktop download queues finish saving
    setTimeout(() => {
      try {
        window.URL.revokeObjectURL(blobUrl);
      } catch {}
    }, 60000);
  }
}

/**
 * Open the generated A4 vector CAF PDF in a new browser tab for preview.
 * Uses the browser's native vector PDF viewer.
 */
export async function previewCafPdf(customerId: string): Promise<void> {
  if (typeof window === 'undefined') return;

  const blob = await fetchCafPdfBlob(customerId, true);
  const blobUrl = window.URL.createObjectURL(blob);

  const pdfWindow = window.open(blobUrl, '_blank');
  if (!pdfWindow || pdfWindow.closed || typeof pdfWindow.closed === 'undefined') {
    window.URL.revokeObjectURL(blobUrl);
    throw new Error(
      'Popup blocked: Please allow popups for this site in your browser to view the CAF PDF.'
    );
  }

  try {
    pdfWindow.focus();
  } catch {}

  // Keep the blob URL alive for 3 minutes so the PDF viewer can buffer and render without premature revocation
  setTimeout(() => {
    try {
      window.URL.revokeObjectURL(blobUrl);
    } catch {}
  }, 180000);
}

// =========================================================================
// Zones & Nodes Hierarchy API Methods
// =========================================================================

export interface StaffUserOption {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
}

export interface RouterOption {
  id: string;
  name: string;
  host: string;
  status?: string;
}

export interface ZoneItem {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  servicePersonId: string | null;
  collectorId: string | null;
  createdAt: string;
  updatedAt: string;
  servicePerson?: StaffUserOption | null;
  collector?: StaffUserOption | null;
  _count?: {
    nodes: number;
    customers: number;
  };
  nodes?: NodeItem[];
}

export interface NodeItem {
  id: string;
  organizationId: string;
  zoneId: string;
  name: string;
  description: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  routerId: string | null;
  status: string; // 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE'
  createdAt: string;
  updatedAt: string;
  zone?: { id: string; name: string };
  router?: RouterOption | null;
  uplinkRouter?: RouterOption | null;
  _count?: {
    customers: number;
  };
}

export interface CreateZonePayload {
  name: string;
  description?: string;
  servicePersonId?: string;
  collectorId?: string;
}

export interface UpdateZonePayload {
  name?: string;
  description?: string;
  servicePersonId?: string | null;
  collectorId?: string | null;
}

export interface CreateNodePayload {
  name: string;
  description?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  routerId?: string | null;
  status?: string;
}

export interface UpdateNodePayload {
  name?: string;
  description?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  routerId?: string | null;
  status?: string;
}

export interface ZoneListResponse {
  items: ZoneItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface NodeListResponse {
  items: NodeItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function listZones(
  filters: { page?: number; limit?: number; search?: string } = {}
): Promise<ZoneListResponse> {
  const params = new URLSearchParams();
  if (filters.page) params.append('page', filters.page.toString());
  if (filters.limit) params.append('limit', filters.limit.toString());
  if (filters.search) params.append('search', filters.search);
  const q = params.toString();
  return apiFetch<ZoneListResponse>(`/zones${q ? `?${q}` : ''}`);
}

export async function getZone(id: string): Promise<ZoneItem> {
  return apiFetch<ZoneItem>(`/zones/${encodeURIComponent(id)}`);
}

export async function createZone(data: CreateZonePayload): Promise<ZoneItem> {
  return apiFetch<ZoneItem>('/zones', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateZone(id: string, data: UpdateZonePayload): Promise<ZoneItem> {
  return apiFetch<ZoneItem>(`/zones/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteZone(id: string): Promise<{ success: boolean; message: string }> {
  return apiFetch<{ success: boolean; message: string }>(`/zones/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function listNodes(
  zoneIdOrFilters?: string | { zoneId?: string; page?: number; limit?: number; search?: string; status?: string },
  maybeFilters: { page?: number; limit?: number; search?: string; status?: string } = {}
): Promise<NodeListResponse> {
  if (typeof zoneIdOrFilters === 'string') {
    const params = new URLSearchParams();
    if (maybeFilters.page) params.append('page', maybeFilters.page.toString());
    if (maybeFilters.limit) params.append('limit', maybeFilters.limit.toString());
    if (maybeFilters.search) params.append('search', maybeFilters.search);
    if (maybeFilters.status) params.append('status', maybeFilters.status);
    const q = params.toString();
    return apiFetch<NodeListResponse>(`/zones/${encodeURIComponent(zoneIdOrFilters)}/nodes${q ? `?${q}` : ''}`);
  }

  const filters = zoneIdOrFilters || {};
  const params = new URLSearchParams();
  if (filters.zoneId) params.append('zoneId', filters.zoneId);
  if (filters.page) params.append('page', filters.page.toString());
  if (filters.limit) params.append('limit', filters.limit.toString());
  if (filters.search) params.append('search', filters.search);
  if (filters.status) params.append('status', filters.status);
  const q = params.toString();
  return apiFetch<NodeListResponse>(`/nodes${q ? `?${q}` : ''}`);
}

export async function getNode(id: string): Promise<NodeItem> {
  return apiFetch<NodeItem>(`/nodes/${encodeURIComponent(id)}`);
}

export async function createNode(zoneId: string, data: CreateNodePayload): Promise<NodeItem> {
  return apiFetch<NodeItem>(`/zones/${encodeURIComponent(zoneId)}/nodes`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateNode(id: string, data: UpdateNodePayload): Promise<NodeItem> {
  return apiFetch<NodeItem>(`/nodes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteNode(id: string): Promise<{ success: boolean; message: string }> {
  return apiFetch<{ success: boolean; message: string }>(`/nodes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
