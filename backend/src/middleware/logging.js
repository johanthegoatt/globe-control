import { randomUUID } from "node:crypto";

export function requestIdMiddleware(req, _res, next) {
  req.requestId = randomUUID();
  next();
}

export function logInfo(req, message, extra = {}) {
  console.log(JSON.stringify({
    level: "info",
    ts: new Date().toISOString(),
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    message,
    ...extra
  }));
}

export function logError(req, message, extra = {}) {
  console.error(JSON.stringify({
    level: "error",
    ts: new Date().toISOString(),
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    message,
    ...extra
  }));
}