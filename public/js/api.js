const API_BASE = "/api";

export function getToken() {
  return localStorage.getItem("freelaunch_token") || "";
}

export function setToken(token) {
  localStorage.setItem("freelaunch_token", token);
}

export function clearToken() {
  localStorage.removeItem("freelaunch_token");
  localStorage.removeItem("freelaunch_role");
}

export function setRole(role) {
  localStorage.setItem("freelaunch_role", role);
}

export function getRole() {
  return localStorage.getItem("freelaunch_role") || "";
}

export async function apiRequest(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}
