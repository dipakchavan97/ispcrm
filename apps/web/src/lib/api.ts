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
  if (typeof window !== 'undefined') {
    const envUrl = process.env.NEXT_PUBLIC_API_URL;
    if (envUrl && !envUrl.includes('localhost')) {
      return envUrl;
    }
    // Match current browser hostname dynamically (e.g. localhost, 127.0.0.1, LAN IP)
    return `${window.location.protocol}//${window.location.hostname}:4000/api`;
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
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
 * Ensure an active authenticated session.
 * If no token is found or forceRefresh is requested, logs in with default seed administrator.
 */
export async function ensureAuthToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const token = getAuthToken();
    if (token) {
      return token;
    }
  }

  const apiBase = getApiBase();
  try {
    const res = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@speednet.in',
        password: 'admin123',
      }),
    });
    const json = await res.json();
    if (json.data?.accessToken) {
      setAuthToken(json.data.accessToken);
      return json.data.accessToken;
    }
  } catch (err) {
    console.error('Failed auto-authenticating seed admin:', err);
  }

  return '';
}

export async function apiFetch<T = any>(
  endpoint: string,
  options: RequestInit = {},
  retryCount = 0,
): Promise<T> {
  let token = getAuthToken();
  if (!token) {
    token = await ensureAuthToken();
  }

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

  // Auto-recover from 401 Unauthorized (expired token in localStorage)
  if (response.status === 401 && retryCount === 0) {
    clearAuthToken();
    const newToken = await ensureAuthToken(true);
    if (newToken) {
      return apiFetch<T>(endpoint, options, retryCount + 1);
    }
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
