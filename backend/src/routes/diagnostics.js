import { Router } from "express";
import { z } from "zod";
import { withClient } from "../db/pool.js";
import { appEventSchema } from "../lib/schemas.js";
import { logError, logInfo } from "../middleware/logging.js";

const router = Router();
const sessionIdParam = z.object({ sessionId: z.string().min(1) });

router.post("/session/:sessionId/events", async (req, res) => {
  try {
    const { sessionId } = sessionIdParam.parse(req.params);
    const parsed = appEventSchema.parse(req.body);

    await withClient((client) =>
      client.query(
        `INSERT INTO app_events (session_id, profile_id, event_type, severity, payload_json)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [sessionId, parsed.profileId ?? null, parsed.eventType, parsed.severity, JSON.stringify(parsed.payload ?? {})]
      )
    );

    logInfo(req, "app_event_ingested", { sessionId, eventType: parsed.eventType });
    return res.json({ ok: true });
  } catch (error) {
    logError(req, "app_event_failed", { error: String(error) });
    return res.status(400).json({ error: "invalid_request" });
  }
});

export { router as diagnosticsRouter };
