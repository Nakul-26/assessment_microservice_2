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

export function isTokenExpired(token) {
  if (!token) return true;
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      window.atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const { exp } = JSON.parse(jsonPayload);
    return Date.now() >= exp * 1000;
  } catch {
    return true;
  }
}

// Add a response interceptor to handle 401 errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // If we get a 401, clear the local storage and notify the app
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      setAuthToken(null);
      window.dispatchEvent(new Event("auth-change"));
    }
    return Promise.reject(error);
  }
);

const storedToken = localStorage.getItem("token");
if (storedToken) {
  if (isTokenExpired(storedToken)) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setAuthToken(null);
  } else {
    setAuthToken(storedToken);
  }
}

export const assessments = {
  list: (params) => api.get("/api/v1/assessments", { params }),
  get: (id) => api.get(`/api/v1/assessments/${id}`),
  getMyAttempt: (id) => api.get(`/api/v1/assessments/${id}/my-attempt`),
  create: (data) => api.post("/api/v1/assessments", data),
  update: (id, data) => api.put(`/api/v1/assessments/${id}`, data),
  delete: (id) => api.delete(`/api/v1/assessments/${id}`),
  start: (id) => api.post(`/api/v1/assessments/${id}/start`),
  submitAttempt: (attemptId) => api.post(`/api/v1/assessments/attempts/${attemptId}/submit`),
  getAttempt: (attemptId) => api.get(`/api/v1/assessments/attempts/${attemptId}`),
  getAttemptSubmissions: (attemptId) => api.get(`/api/v1/assessments/attempts/${attemptId}/submissions`),
  listAttempts: (assessmentId) => api.get(`/api/v1/assessments/${assessmentId}/attempts`),
  getAttendance: (id) => api.get(`/api/v1/assessments/${id}/attendance`),
  getAnalytics: (id) => api.get(`/api/v1/assessments/${id}/analytics`),
  saveDraft: (attemptId, codeDrafts) => api.post(`/api/v1/assessments/attempts/${attemptId}/draft`, { codeDrafts }),
  lock: (id) => api.post(`/api/v1/assessments/${id}/lock`),
  unlock: (id) => api.post(`/api/v1/assessments/${id}/unlock`),
  addGraceTime: (attemptId, graceMinutes) => api.post(`/api/v1/assessments/attempts/${attemptId}/grace`, { graceMinutes }),
  logEvent: (attemptId, eventType) => api.post(`/api/v1/assessments/attempts/${attemptId}/log-event`, { eventType }),
  raiseChallenge: (attemptId, reason) => api.post(`/api/v1/assessments/attempts/${attemptId}/challenge`, { reason }),
  resolveChallenge: (attemptId, status, facultyComment) => api.post(`/api/v1/assessments/attempts/${attemptId}/challenge/resolve`, { status, facultyComment })
};

export const problems = {
  list: (params) => api.get("/api/v1/problems", { params }),
  get: (id) => api.get(`/api/v1/problems/${id}`),
  run: (id, data) => api.post(`/api/v1/problems/${id}/run`, data),
  getStats: (id) => api.get(`/api/v1/problems/${id}/stats`),
  delete: (id) => api.delete(`/api/v1/problems/${id}`)
};

export const submissions = {
  getAnalytics: () => api.get('/api/v1/submissions/analytics/my')
};

export const admin = {
  getSystemStats: () => api.get("/api/v1/admin/system-stats"),
  getAuditLogs: (params) => api.get("/api/v1/admin/audit-logs", { params }),
  bulkImportStudents: (data) => api.post("/api/v1/admin/bulk-import-students", data),
  listUsers: (params) => api.get("/api/v1/admin/users", { params }),
  resetPassword: (userId, newPassword) => api.post(`/api/v1/admin/users/${userId}/reset-password`, { newPassword }),
  updateBanner: (data) => api.post("/api/v1/admin/banner", data),
  downloadBackup: () => api.get("/api/v1/admin/backup", { responseType: 'blob' }),
  restoreDatabase: (data) => api.post("/api/v1/admin/restore", data)
};

export const system = {
  getBanner: () => api.get("/api/v1/health/banner")
};

export const questions = {
  list: (params) => api.get("/api/v1/questions", { params }),
  tags: () => api.get("/api/v1/questions/tags"),
  get: (id) => api.get(`/api/v1/questions/${id}`),
  create: (data) => api.post("/api/v1/questions", data),
  update: (id, data) => api.put(`/api/v1/questions/${id}`, data),
  delete: (id) => api.delete(`/api/v1/questions/${id}`)
};

export const billing = {
  getStatus: () => api.get("/api/v1/billing/status"),
  createCheckout: (planId) => api.post("/api/v1/billing/checkout", { planId }),
  createPortal: () => api.post("/api/v1/billing/portal"),
  listColleges: () => api.get("/api/v1/billing/colleges"),
  setCollegePlan: (collegeId, data) => api.patch(`/api/v1/billing/colleges/${collegeId}/plan`, data)
};

export default api;
