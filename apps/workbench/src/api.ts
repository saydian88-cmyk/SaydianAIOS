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

export function uploadWithProgress<T>(
  path: string,
  body: FormData,
  onProgress: (loaded: number, total: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", path);
    if (getToken()) request.setRequestHeader("authorization", `Bearer ${getToken()}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    request.onerror = () => reject(new Error("上传网络中断，请重试"));
    request.onload = () => {
      let response: Record<string, unknown> = {};
      try { response = request.responseText ? JSON.parse(request.responseText) as Record<string, unknown> : {}; }
      catch { response = {}; }
      if (request.status >= 200 && request.status < 300) resolve(response as T);
      else reject(new Error(String(response.message || response.error || `请求失败（${request.status}）`)));
    };
    request.send(body);
  });
}
