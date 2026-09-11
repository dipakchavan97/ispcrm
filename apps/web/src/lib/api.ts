const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

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
 * If no token is found, logs in with default seed administrator.
 */
export async function ensureAuthToken(): Promise<string> {
  let token = getAuthToken();
  if (token) {
    return token;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
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

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  const json: ApiResponse<T> = await response.json();

  if (!response.ok || json.success === false) {
    const errorMsg = json.error?.message || response.statusText || 'API request failed';
    throw new Error(errorMsg);
  }

  return json.data !== undefined ? json.data : (json as unknown as T);
}
