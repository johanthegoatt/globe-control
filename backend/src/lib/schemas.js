import { z } from "zod";

export const settingsSchema = z.object({
  orbitSensitivity: z.number().min(0.1).max(5),
  zoomSensitivity: z.number().min(0.1).max(5),
  smoothing: z.number().min(0.01).max(0.8),
  autoRotate: z.boolean(),
  debugEnabled: z.boolean(),
  qualityPreset: z.enum(["low", "balanced", "high", "precision", "fast"]).default("balanced"),
  updatedAt: z.string(),
  schemaVersion: z.number().int().positive()
});

export const calibrationSchema = z.object({
  pinchOn: z.number().min(0).max(2),
  pinchOff: z.number().min(0).max(2),
  deadzone: z.number().min(0).max(0.2),
  confidenceFloor: z.number().min(0).max(1),
  cameraSignature: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  updatedAt: z.string()
});

export const sessionStartSchema = z.object({
  profileId: z.string().min(1),
  clientTs: z.string(),
  metadata: z.record(z.any()).optional()
});

export const sessionMetricsSchema = z.object({
  windowStart: z.string(),
  windowEnd: z.string(),
  avgFps: z.number().min(0).max(240),
  latencyMs: z.number().min(0).max(10_000).default(0),
  trackingState: z.enum(["locked", "searching", "lost"]),
  qualityScore: z.number().min(0).max(1),
  modeDistribution: z
    .object({
      idle: z.number().int().nonnegative().default(0),
      orbit: z.number().int().nonnegative().default(0),
      zoom: z.number().int().nonnegative().default(0)
    })
    .default({ idle: 0, orbit: 0, zoom: 0 }),
  pinEvents: z
    .object({
      verified: z.number().int().nonnegative().default(0),
      review: z.number().int().nonnegative().default(0),
      blocked: z.number().int().nonnegative().default(0)
    })
    .default({ verified: 0, review: 0, blocked: 0 }),
  rejectionReasons: z.record(z.number().int().nonnegative()).default({}),
  pinchAttempts: z.number().int().nonnegative().default(0),
  pinchSuccesses: z.number().int().nonnegative().default(0),
  falseOrbitCount: z.number().int().nonnegative().default(0),
  errorCounters: z.record(z.number()).default({}),
  payload: z.record(z.any()).default({})
});

export const sessionEndSchema = z.object({
  status: z.enum(["completed", "aborted", "error"]),
  clientTs: z.string()
});

export const locationVerifySchema = z.object({
  profileId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  geo: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000).optional()
  }),
  clientTs: z.string()
});

export const locationFocusValidateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  rotation: z.object({
    x: z.number(),
    y: z.number()
  }),
  tolerance: z.number().min(0).max(1).default(0.12)
});

export const appEventSchema = z.object({
  profileId: z.string().min(1).optional(),
  eventType: z.string().min(1),
  severity: z.enum(["info", "warn", "error"]).default("info"),
  payload: z.record(z.any()).default({})
});
