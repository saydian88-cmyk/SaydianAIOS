const apiBase = String(
  import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? "http://127.0.0.1:3210" : ""),
).replace(/\/$/, "");
const tokenKey = "saidian-ops-token";
const actorKey = "saidian-ops-actor";

export function getToken() {
  return localStorage.getItem(tokenKey) || (import.meta.env.DEV ? "saidian-ops-local" : "");
}

export function setToken(value: string) {
  localStorage.setItem(tokenKey, value.trim());
}

export function clearToken() {
  localStorage.removeItem(tokenKey);
  localStorage.removeItem(actorKey);
}

export function getActor() {
  return localStorage.getItem(actorKey) || "运营负责人";
}

export function setActor(value: string) {
  localStorage.setItem(actorKey, value.trim() || "运营负责人");
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isFormData = init.body instanceof FormData;
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${getToken()}`,
      "x-ops-actor": encodeURIComponent(getActor()),
      ...(init.body && !isFormData ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.message || body.error || `请求失败：${response.status}`));
  return body as T;
}

export function post<T>(path: string, body?: unknown) {
  return api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

export function patch<T>(path: string, body: unknown) {
  return api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export function upload<T>(path: string, body: FormData) {
  return api<T>(path, { method: "POST", body });
}
