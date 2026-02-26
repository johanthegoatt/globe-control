import { api } from "../api/client.js";

export function createTelemetryClient({ profileId, onSyncState }) {
  let sessionId = null;
  const metricsBuffer = [];
  const eventBuffer = [];
  let flushTimer = null;

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushAll().catch(() => {
        onSyncState("offline-fallback");
      });
    }, 4500);
  }

  async function start() {
    try {
      onSyncState("syncing");
      const data = await api.startSession({
        profileId,
        clientTs: new Date().toISOString(),
        metadata: { source: "vivet-v5" }
      });
      sessionId = data.sessionId;
      onSyncState("synced");
    } catch {
      onSyncState("offline-fallback");
    }
  }

  function push(metric) {
    if (!sessionId) return;
    metricsBuffer.push(metric);
    if (metricsBuffer.length >= 4) {
      flushAll().catch(() => {
        onSyncState("offline-fallback");
      });
      return;
    }
    scheduleFlush();
  }

  function recordEvent(eventType, severity = "info", payload = {}) {
    if (!sessionId) return;
    eventBuffer.push({ eventType, severity, payload });
    if (eventBuffer.length >= 8) {
      flushEvents().catch(() => {
        onSyncState("offline-fallback");
      });
      return;
    }
    scheduleFlush();
  }

  async function flushEvents() {
    if (!sessionId || !eventBuffer.length) return;
    const queue = eventBuffer.splice(0, eventBuffer.length);
    onSyncState("syncing");
    for (const event of queue) {
      await api.postSessionEvent(sessionId, {
        profileId,
        eventType: event.eventType,
        severity: event.severity,
        payload: event.payload
      });
    }
    onSyncState("synced");
  }

  function sum(items, key) {
    return items.reduce((acc, item) => acc + Number(item[key] || 0), 0);
  }

  function mergeCounter(items, key) {
    return items.reduce((acc, item) => {
      const src = item[key] || {};
      Object.entries(src).forEach(([counterKey, counterValue]) => {
        acc[counterKey] = (acc[counterKey] || 0) + Number(counterValue || 0);
      });
      return acc;
    }, {});
  }

  async function flush() {
    if (!sessionId || !metricsBuffer.length) return;
    const batch = metricsBuffer.splice(0, metricsBuffer.length);
    const avgFps = sum(batch, "avgFps") / batch.length;
    const qualityScore = sum(batch, "qualityScore") / batch.length;
    const latencyMs = sum(batch, "latencyMs") / batch.length;

    const payload = {
      windowStart: batch[0].windowStart,
      windowEnd: batch[batch.length - 1].windowEnd,
      avgFps,
      latencyMs,
      trackingState: batch[batch.length - 1].trackingState,
      qualityScore,
      modeDistribution: mergeCounter(batch, "modeDistribution"),
      pinEvents: mergeCounter(batch, "pinEvents"),
      rejectionReasons: mergeCounter(batch, "rejectionReasons"),
      pinchAttempts: sum(batch, "pinchAttempts"),
      pinchSuccesses: sum(batch, "pinchSuccesses"),
      falseOrbitCount: sum(batch, "falseOrbitCount"),
      errorCounters: mergeCounter(batch, "errorCounters"),
      payload: { batch }
    };

    onSyncState("syncing");
    await api.postMetrics(sessionId, payload);
    onSyncState("synced");
  }

  async function flushAll() {
    await flush();
    await flushEvents();
  }

  async function end(status = "completed") {
    try {
      await flushAll();
      if (sessionId) {
        onSyncState("syncing");
        await api.endSession(sessionId, { status, clientTs: new Date().toISOString() });
      }
      onSyncState("synced");
    } catch {
      onSyncState("offline-fallback");
    } finally {
      sessionId = null;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      metricsBuffer.length = 0;
      eventBuffer.length = 0;
    }
  }

  return { start, push, recordEvent, end, getSessionId: () => sessionId };
}
