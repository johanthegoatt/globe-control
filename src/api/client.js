import { RUNTIME_CONFIG } from "../config.js";

// Single source of truth for frontend -> backend API routing.
export const API_CONFIG = {
  baseUrl: RUNTIME_CONFIG.apiBaseUrl,
  timeoutMs: 3500,
  retries: 2,
  retryDelayMs: 350
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await promise(controller.signal);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function request(path, options = {}) {
  const method = options.method || "GET";
  let attempt = 0;
  let lastError;

  while (attempt <= API_CONFIG.retries) {
    try {
      const response = await withTimeout(
        (signal) =>
          fetch(`${API_CONFIG.baseUrl}${path}`, {
            method,
            headers: {
              "Content-Type": "application/json",
              ...(options.headers || {})
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal
          }),
        API_CONFIG.timeoutMs
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      if (response.status === 204) return null;
      return await response.json();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt > API_CONFIG.retries) break;
      await delay(API_CONFIG.retryDelayMs * attempt);
    }
  }

  throw lastError;
}

export const api = {
  getHealth: () => request("/health"),
  getRuntimeConfig: () => request("/config/runtime"),
  getProfile: (profileId) => request(`/profile/${profileId}`),
  putSettings: (profileId, payload) => request(`/profile/${profileId}/settings`, { method: "PUT", body: payload }),
  getCalibration: (profileId) => request(`/profile/${profileId}/calibration`),
  putCalibration: (profileId, payload) => request(`/profile/${profileId}/calibration`, { method: "PUT", body: payload }),
  startSession: (payload) => request("/session/start", { method: "POST", body: payload }),
  postMetrics: (sessionId, payload) => request(`/session/${sessionId}/metrics`, { method: "POST", body: payload }),
  postSessionEvent: (sessionId, payload) => request(`/session/${sessionId}/events`, { method: "POST", body: payload }),
  getSessionSummary: (sessionId) => request(`/session/${sessionId}/summary`),
  endSession: (sessionId, payload) => request(`/session/${sessionId}/end`, { method: "POST", body: payload }),
  verifyLocation: (payload) => request("/location/verify", { method: "POST", body: payload }),
  retryLocationVerification: (payload) => request("/location/verify/retry", { method: "POST", body: payload }),
  validateFocusTransform: (payload) => request("/location/focus/validate", { method: "POST", body: payload })
};
