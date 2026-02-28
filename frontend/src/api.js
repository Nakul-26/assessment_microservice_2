import axios from "axios";

function resolveBaseUrl() {
  const raw = import.meta.env.VITE_API_URL;
  if (!raw) return "";

  // If a Docker-internal host leaks to browser config, fallback to same-origin proxy.
  if (typeof window !== "undefined" && raw.includes("assessment-api")) {
    return "";
  }

  return raw;
}

const api = axios.create({
  baseURL: resolveBaseUrl()
});

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

const storedToken = localStorage.getItem("token");
if (storedToken) {
  setAuthToken(storedToken);
}

export default api;
