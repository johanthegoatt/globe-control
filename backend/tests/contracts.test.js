import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { locationFocusValidateSchema, sessionMetricsSchema } from "../src/lib/schemas.js";

test("health endpoint returns ok", async () => {
  const app = createApp();
  const res = await request(app).get("/api/v1/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test("runtime config endpoint returns policy and schema versions", async () => {
  const app = createApp();
  const res = await request(app).get("/api/v1/config/runtime");
  assert.equal(res.status, 200);
  assert.ok(res.body.policyVersion);
  assert.ok(res.body.schemaVersions);
});

test("location focus validate schema accepts valid payload", () => {
  const parsed = locationFocusValidateSchema.parse({
    lat: 38.8895,
    lng: -77.0352,
    rotation: { x: -0.678, y: 4.48 }
  });
  assert.equal(typeof parsed.tolerance, "number");
});

test("session metrics schema requires bounded values", () => {
  const parsed = sessionMetricsSchema.parse({
    windowStart: new Date().toISOString(),
    windowEnd: new Date().toISOString(),
    avgFps: 59,
    latencyMs: 12,
    trackingState: "locked",
    qualityScore: 0.92,
    modeDistribution: { idle: 1, orbit: 2, zoom: 3 },
    pinEvents: { verified: 1, review: 0, blocked: 0 },
    rejectionReasons: { low_confidence: 1 },
    pinchAttempts: 3,
    pinchSuccesses: 2,
    falseOrbitCount: 0,
    errorCounters: { trackingErrors: 0 },
    payload: { sample: true }
  });
  assert.equal(parsed.avgFps, 59);
});

test("startup refuses a missing database and the public salt in production", async () => {
  const { checkStartupConfig } = await import("../src/config.js");
  const base = { databaseUrl: "postgres://x", ipHashSalt: "dev_salt_change_me" };
  assert.deepEqual(checkStartupConfig({}, base), []);
  assert.match(checkStartupConfig({ NODE_ENV: "production" }, base).join(" "), /IP_HASH_SALT/);
  assert.match(checkStartupConfig({}, { ...base, databaseUrl: null }).join(" "), /DATABASE_URL/);
  assert.deepEqual(checkStartupConfig({ NODE_ENV: "production" }, { ...base, ipHashSalt: "s3cret" }), []);
});
