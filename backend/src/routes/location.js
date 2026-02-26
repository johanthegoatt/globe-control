import { Router } from "express";
import { config } from "../config.js";
import { withClient } from "../db/pool.js";
import { evaluateLocationRisk } from "../lib/ipRisk.js";
import { locationFocusValidateSchema, locationVerifySchema } from "../lib/schemas.js";
import { logError, logInfo } from "../middleware/logging.js";

const router = Router();
const RETRY_WINDOW_MINUTES = 20;

function decideStatus({ riskScore, previousHighRiskCount }) {
  if (riskScore >= 70) {
    if (previousHighRiskCount >= 1) return "blocked";
    return "needs_review";
  }
  if (riskScore >= 45) return "needs_review";
  return "verified";
}

async function ensureProfile(client, profileId) {
  await client.query(
    `INSERT INTO profiles (id, label) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
    [profileId, "default"]
  );
}

async function getRecentHighRiskCount(client, profileId) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM location_events
     WHERE profile_id = $1
       AND ts > NOW() - ($2 || ' minutes')::interval
       AND status IN ('needs_review', 'blocked')
       AND trust_level <= 30`,
    [profileId, RETRY_WINDOW_MINUTES]
  );
  return result.rows[0]?.count || 0;
}

async function runVerification(req, res, mode = "verify") {
  try {
    const payload = locationVerifySchema.parse(req.body);
    const risk = await evaluateLocationRisk(req, payload.geo);

    const result = await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await ensureProfile(client, payload.profileId);
        const previousHighRiskCount = await getRecentHighRiskCount(client, payload.profileId);
        const status = decideStatus({ riskScore: risk.riskScore, previousHighRiskCount });

        const reasonCodes = risk.reasonCodes.length ? risk.reasonCodes : ["LOW_RISK"];
        const pin = {
          lat: payload.geo.lat,
          lng: payload.geo.lng
        };

        await client.query(
          `INSERT INTO location_events
           (profile_id, session_id, coarse_lat, coarse_lng, ip_hash, trust_level, status, reason_codes, payload_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
          [
            payload.profileId,
            payload.sessionId ?? null,
            risk.coarseLat,
            risk.coarseLng,
            risk.ipHash,
            risk.trustLevel,
            status,
            JSON.stringify(reasonCodes),
            JSON.stringify({
              mode,
              policyVersion: config.policyVersion,
              riskScore: risk.riskScore,
              signals: {
                ipLat: risk.signals.ipLat,
                ipLng: risk.signals.ipLng,
                distanceKm: risk.signals.distanceKm,
                browserAccuracyM: risk.signals.browserAccuracyM,
                asn: risk.signals.asn,
                asnOrg: risk.signals.asnOrg,
                trait: risk.signals.trait
              },
              geo: payload.geo,
              clientTs: payload.clientTs
            })
          ]
        );

        await client.query("COMMIT");

        return {
          status,
          trustLevel: Number(risk.trustLevel.toFixed(1)),
          reasonCodes,
          pin
        };
      } catch (inner) {
        await client.query("ROLLBACK");
        throw inner;
      }
    });

    logInfo(req, "location_verification_completed", {
      profileId: payload.profileId,
      status: result.status,
      trustLevel: result.trustLevel
    });

    if (result.status === "verified") {
      return res.json({
        status: "verified",
        pin: result.pin,
        trustLevel: result.trustLevel,
        reasonCodes: result.reasonCodes
      });
    }

    return res.json({
      status: result.status,
      trustLevel: result.trustLevel,
      reasonCodes: result.reasonCodes
    });
  } catch (error) {
    logError(req, "location_verification_failed", { error: String(error) });
    return res.status(400).json({ error: "invalid_request" });
  }
}

router.post("/location/verify", async (req, res) => runVerification(req, res, "verify"));
router.post("/location/verify/retry", async (req, res) => runVerification(req, res, "retry"));

router.get("/location/policy", async (_req, res) => {
  res.json({
    mode: "best_effort_confidence",
    policyVersion: config.policyVersion,
    schemaVersion: config.schemaVersions.locationPolicy,
    thresholds: {
      verifiedMaxRisk: 44,
      reviewMaxRisk: 69,
      blockedMinRisk: 70
    },
    blockRule: "requires_persistent_high_risk"
  });
});

router.post("/location/focus/validate", async (req, res) => {
  try {
    const parsed = locationFocusValidateSchema.parse(req.body);
    const latRad = (parsed.lat * Math.PI) / 180;
    const lngRad = (parsed.lng * Math.PI) / 180;
    const expectedX = Math.max(-Math.PI * 0.42, Math.min(Math.PI * 0.42, -latRad));
    const expectedY = Math.PI - lngRad;

    const dx = Math.abs(expectedX - parsed.rotation.x);
    const dy = Math.abs(expectedY - parsed.rotation.y);
    const mismatch = dx > parsed.tolerance || dy > parsed.tolerance;

    return res.json({
      ok: !mismatch,
      mismatch,
      diff: { x: dx, y: dy },
      expected: { x: expectedX, y: expectedY },
      reason: mismatch ? "focus_transform_mismatch" : null
    });
  } catch (error) {
    logError(req, "focus_validate_failed", { error: String(error) });
    return res.status(400).json({ error: "invalid_request" });
  }
});

export { router as locationRouter };
