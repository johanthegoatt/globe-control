const buckets = new Map();

function createRateLimit(maxPerMinute, keyFn) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const windowStart = now - 60_000;

    const arr = buckets.get(key) || [];
    const active = arr.filter((t) => t > windowStart);
    active.push(now);
    buckets.set(key, active);

    if (active.length > maxPerMinute) {
      return res.status(429).json({ error: "rate_limited" });
    }

    next();
  };
}

export function metricsRateLimit(maxPerMinute) {
  return createRateLimit(maxPerMinute, (req) => `${req.ip}:${req.params.sessionId || "start"}`);
}

export function locationRateLimit(maxPerMinute) {
  return createRateLimit(maxPerMinute, (req) => `${req.ip}:${req.path}`);
}

export function diagnosticsRateLimit(maxPerMinute) {
  return createRateLimit(maxPerMinute, (req) => `${req.ip}:diag:${req.params.sessionId || "global"}`);
}
