import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withClient } from "../db/pool.js";
import { sessionEndSchema, sessionMetricsSchema, sessionStartSchema } from "../lib/schemas.js";
import { logError, logInfo } from "../middleware/logging.js";

const router = Router();
const sessionIdParam = z.object({ sessionId: z.string().min(1) });

router.post("/session/start", async (req, res) => {
  try {
    const parsed = sessionStartSchema.parse(req.body);
    const sessionId = randomUUID();

    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          `INSERT INTO profiles (id, label) VALUES ($1, $2)
           ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
          [parsed.profileId, "default"]
        );
        await client.query(
          `INSERT INTO sessions (id, profile_id, status) VALUES ($1, $2, $3)`,
          [sessionId, parsed.profileId, "running"]
        );
        await client.query("COMMIT");
      } catch (inner) {
        await client.query("ROLLBACK");
        throw inner;
      }
    });

    logInfo(req, "session_started", { sessionId, profileId: parsed.profileId });
    return res.json({ sessionId, status: "running" });
  } catch (error) {
    logError(req, "session_start_failed", { error: String(error) });
    return res.status(400).json({ error: "invalid_request" });
  }
});

router.post("/session/:sessionId/metrics", async (req, res) => {
  try {
    const { sessionId } = sessionIdParam.parse(req.params);
    const parsed = sessionMetricsSchema.parse(req.body);

    await withClient((client) =>
      client.query(
        `INSERT INTO session_metrics
         (session_id, fps, tracking_state, quality_score, latency_ms, pinch_attempts, pinch_successes, false_orbit_count, error_counts, payload_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)`,
        [
          sessionId,
          parsed.avgFps,
          parsed.trackingState,
          parsed.qualityScore,
          parsed.latencyMs,
          parsed.pinchAttempts,
          parsed.pinchSuccesses,
          parsed.falseOrbitCount,
          JSON.stringify(parsed.errorCounters || {}),
          JSON.stringify(parsed)
        ]
      )
    );

    logInfo(req, "session_metrics_ingested", { sessionId });
    return res.json({ ok: true });
  } catch (error) {
    logError(req, "session_metrics_failed", { error: String(error) });
    return res.status(400).json({ error: "invalid_request" });
  }
});

router.get("/session/:sessionId/summary", async (req, res) => {
  try {
    const { sessionId } = sessionIdParam.parse(req.params);
    const summary = await withClient(async (client) => {
      const metrics = await client.query(
        `SELECT
           COUNT(*)::int AS points,
           COALESCE(AVG(fps), 0) AS avg_fps,
           COALESCE(MAX(fps), 0) AS peak_fps,
           COALESCE(AVG(quality_score), 0) AS avg_quality,
           COALESCE(AVG(latency_ms), 0) AS avg_latency_ms,
           COALESCE(SUM(pinch_attempts), 0)::int AS pinch_attempts,
           COALESCE(SUM(pinch_successes), 0)::int AS pinch_successes,
           COALESCE(SUM(false_orbit_count), 0)::int AS false_orbit_count,
           COALESCE(SUM((payload_json->'modeDistribution'->>'idle')::int), 0)::int AS mode_idle_count,
           COALESCE(SUM((payload_json->'modeDistribution'->>'orbit')::int), 0)::int AS mode_orbit_count,
           COALESCE(SUM((payload_json->'modeDistribution'->>'zoom')::int), 0)::int AS mode_zoom_count
         FROM session_metrics
         WHERE session_id = $1`,
        [sessionId]
      );

      const tracking = await client.query(
        `SELECT tracking_state, COUNT(*)::int AS count
         FROM session_metrics
         WHERE session_id = $1
         GROUP BY tracking_state`,
        [sessionId]
      );

      const eventCounts = await client.query(
        `SELECT severity, COUNT(*)::int AS count
         FROM app_events
         WHERE session_id = $1
         GROUP BY severity`,
        [sessionId]
      );

      return {
        sessionId,
        stats: metrics.rows[0],
        trackingDistribution: tracking.rows,
        appEventDistribution: eventCounts.rows
      };
    });

    logInfo(req, "session_summary_fetched", { sessionId });
    return res.json(summary);
  } catch (error) {
    logError(req, "session_summary_failed", { error: String(error) });
    return res.status(400).json({ error: "invalid_request" });
  }
});

router.post("/session/:sessionId/end", async (req, res) => {
  try {
    const { sessionId } = sessionIdParam.parse(req.params);
    const parsed = sessionEndSchema.parse(req.body);

    const result = await withClient((client) =>
      client.query(
        `UPDATE sessions SET ended_at = NOW(), status = $2 WHERE id = $1 RETURNING id, status, ended_at`,
        [sessionId, parsed.status]
      )
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "session_not_found" });
    }

    logInfo(req, "session_ended", { sessionId, status: parsed.status });
    return res.json({ session: result.rows[0] });
  } catch (error) {
    logError(req, "session_end_failed", { error: String(error) });
    return res.status(400).json({ error: "invalid_request" });
  }
});

export { router as sessionRouter };
