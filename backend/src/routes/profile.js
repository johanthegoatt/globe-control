import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { withClient } from "../db/pool.js";
import { calibrationSchema, settingsSchema } from "../lib/schemas.js";
import { logError, logInfo } from "../middleware/logging.js";

const router = Router();

const profileIdParam = z.object({ profileId: z.string().min(1) });

async function ensureProfile(client, profileId) {
  await client.query(
    `INSERT INTO profiles (id, label) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
    [profileId, "default"]
  );
}

router.get("/profile/:profileId", async (req, res) => {
  try {
    const { profileId } = profileIdParam.parse(req.params);

    const result = await withClient(async (client) => {
      await ensureProfile(client, profileId);
      const profile = await client.query("SELECT id, label, created_at, updated_at FROM profiles WHERE id = $1", [profileId]);
      const settings = await client.query("SELECT payload_json, version, updated_at FROM settings WHERE profile_id = $1", [profileId]);
      const calibration = await client.query("SELECT payload_json, valid_until, updated_at FROM calibration WHERE profile_id = $1", [profileId]);

      return {
        profile: profile.rows[0],
        settings: settings.rows[0] || null,
        calibration: calibration.rows[0] || null,
        schemaVersions: config.schemaVersions
      };
    });

    logInfo(req, "profile_fetched", { profileId });
    return res.json(result);
  } catch (error) {
    logError(req, "profile_fetch_failed", { error: String(error) });
    return res.status(400).json({ error: "invalid_request" });
  }
});

router.put("/profile/:profileId/settings", async (req, res) => {
  try {
    const { profileId } = profileIdParam.parse(req.params);
    const parsed = settingsSchema.parse(req.body);
    if (parsed.schemaVersion !== config.schemaVersions.settings) {
      return res.status(400).json({
        error: "schema_version_mismatch",
        expected: config.schemaVersions.settings,
        received: parsed.schemaVersion
      });
    }

    const out = await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await ensureProfile(client, profileId);
        const existing = await client.query("SELECT payload_json, updated_at FROM settings WHERE profile_id = $1", [profileId]);

        if (existing.rowCount && String(new Date(existing.rows[0].payload_json.updatedAt)) > String(new Date(parsed.updatedAt))) {
          await client.query("COMMIT");
          return { conflict: true, current: existing.rows[0].payload_json };
        }

        await client.query(
          `INSERT INTO settings (profile_id, payload_json, version, updated_at)
           VALUES ($1, $2::jsonb, COALESCE((SELECT version + 1 FROM settings WHERE profile_id = $1), 1), NOW())
           ON CONFLICT (profile_id)
           DO UPDATE SET payload_json = EXCLUDED.payload_json, version = settings.version + 1, updated_at = NOW()`,
          [profileId, JSON.stringify(parsed)]
        );

        const saved = await client.query("SELECT payload_json, version, updated_at FROM settings WHERE profile_id = $1", [profileId]);
        await client.query("COMMIT");
        return { conflict: false, saved: saved.rows[0] };
      } catch (inner) {
        await client.query("ROLLBACK");
        throw inner;
      }
    });

    logInfo(req, "settings_upserted", { profileId, conflict: out.conflict });
    return res.json(out);
  } catch (error) {
    logError(req, "settings_upsert_failed", { error: String(error) });
    return res.status(400).json({ error: "invalid_request" });
  }
});

router.get("/profile/:profileId/calibration", async (req, res) => {
  try {
    const { profileId } = profileIdParam.parse(req.params);
    const out = await withClient((client) =>
      client.query("SELECT payload_json, valid_until, updated_at FROM calibration WHERE profile_id = $1", [profileId])
    );
    logInfo(req, "calibration_fetched", { profileId });
    return res.json({ calibration: out.rows[0] || null });
  } catch (error) {
    logError(req, "calibration_fetch_failed", { error: String(error) });
    return res.status(400).json({ error: "invalid_request" });
  }
});

router.put("/profile/:profileId/calibration", async (req, res) => {
  try {
    const { profileId } = profileIdParam.parse(req.params);
    const parsed = calibrationSchema.parse(req.body);
    if (parsed.schemaVersion !== config.schemaVersions.calibration) {
      return res.status(400).json({
        error: "schema_version_mismatch",
        expected: config.schemaVersions.calibration,
        received: parsed.schemaVersion
      });
    }

    const out = await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await ensureProfile(client, profileId);
        await client.query(
          `INSERT INTO calibration (profile_id, payload_json, valid_until, updated_at)
           VALUES ($1, $2::jsonb, NOW() + INTERVAL '30 days', NOW())
           ON CONFLICT (profile_id)
           DO UPDATE SET payload_json = EXCLUDED.payload_json, valid_until = EXCLUDED.valid_until, updated_at = NOW()`,
          [profileId, JSON.stringify(parsed)]
        );
        const saved = await client.query("SELECT payload_json, valid_until, updated_at FROM calibration WHERE profile_id = $1", [profileId]);
        await client.query("COMMIT");
        return saved.rows[0];
      } catch (inner) {
        await client.query("ROLLBACK");
        throw inner;
      }
    });

    logInfo(req, "calibration_upserted", { profileId });
    return res.json({ calibration: out });
  } catch (error) {
    logError(req, "calibration_upsert_failed", { error: String(error) });
    return res.status(400).json({ error: "invalid_request" });
  }
});

export { router as profileRouter };
