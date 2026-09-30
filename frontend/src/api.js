const TOKEN_KEY = "cnc_offset_token";
const USER_KEY = "cnc_offset_user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...options, headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const msg = data?.detail || data?.message || `请求失败 (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

export function login(username, password) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function fetchSubmissions() {
  return request("/submissions");
}

export function fetchSubmission(id) {
  return request(`/submissions/${id}`);
}

export function createSubmission(tool_code, offset_um) {
  return request("/submissions", {
    method: "POST",
    body: JSON.stringify({ tool_code, offset_um: Number(offset_um) }),
  });
}

// ---- 刀补连线台 ----

export function fetchTrendPoints(limit) {
  return request(`/trend/points?limit=${encodeURIComponent(limit)}`);
}

export function compareTrend({ limit, first_id, second_id }) {
  return request("/trend/compare", {
    method: "POST",
    body: JSON.stringify({ limit, first_id, second_id }),
  });
}

export function checkoutTrend({ limit, first_id = null, second_id = null }) {
  return request("/trend/checkout", {
    method: "POST",
    body: JSON.stringify({ limit, first_id, second_id }),
  });
}

export function fetchSnapshots() {
  return request("/trend/snapshots");
}

export function fetchSnapshot(id) {
  return request(`/trend/snapshots/${id}`);
}
