const tokenKey = "saidian-workbench-token";

export function getToken() {
  return localStorage.getItem(tokenKey) || "";
}

export function setToken(token: string) {
  localStorage.setItem(tokenKey, token);
}

export function clearToken() {
  localStorage.removeItem(tokenKey);
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (getToken()) headers.set("authorization", `Bearer ${getToken()}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result.message || `请求失败（${response.status}）`));
  return result as T;
}

export function post<T>(path: string, body?: Record<string, unknown>) {
  return api<T>(path, { method: "POST", body: JSON.stringify(body || {}) });
}
