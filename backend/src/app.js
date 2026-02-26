import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { requestIdMiddleware } from "./middleware/logging.js";
import { diagnosticsRateLimit, locationRateLimit, metricsRateLimit } from "./middleware/rateLimit.js";
import { diagnosticsRouter } from "./routes/diagnostics.js";
import { locationRouter } from "./routes/location.js";
import { profileRouter } from "./routes/profile.js";
import { sessionRouter } from "./routes/session.js";

function hashOrigins(origins) {
  return crypto.createHash("sha256").update(origins.join(",")).digest("hex").slice(0, 12);
}

export function createApp() {
  const app = express();
  app.set("trust proxy", config.trustProxyHops);

  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestIdMiddleware);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Origin not allowed"), false);
      }
    })
  );

  app.get("/api/v1/health", (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  app.get("/api/v1/config/runtime", (_req, res) => {
    res.json({
      apiVersion: "v1",
      port: config.port,
      policyVersion: config.policyVersion,
      schemaVersions: config.schemaVersions,
      corsOriginsHash: hashOrigins(config.corsOrigins),
      corsOriginsCount: config.corsOrigins.length
    });
  });

  app.get("/", (_req, res) => {
    res.status(200).json({
      service: "globe-control-backend",
      ok: true,
      frontend: config.frontendAppUrl,
      health: "/api/v1/health"
    });
  });

  app.use("/api/v1", profileRouter);
  app.use("/api/v1", metricsRateLimit(config.metricsMaxPerMinute), sessionRouter);
  app.use("/api/v1", locationRateLimit(config.locationVerifyMaxPerMinute), locationRouter);
  app.use("/api/v1", diagnosticsRateLimit(config.diagnosticsMaxPerMinute), diagnosticsRouter);

  app.use((err, _req, res, _next) => {
    const status = err?.name === "ZodError" ? 400 : 500;
    const payload =
      status === 400 ? { error: "validation_failed", detail: err.issues } : { error: "internal_error" };
    res.status(status).json(payload);
  });

  return app;
}
