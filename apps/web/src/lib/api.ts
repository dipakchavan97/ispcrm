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
