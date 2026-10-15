import dotenv from "dotenv";

dotenv.config();

function req(key, fallback) {
  const value = process.env[key] ?? fallback;
  if (value == null) {
    throw new Error(`Missing env var: ${key}`);
  }
  return value;
}

const DEV_SALT = "dev_salt_change_me";

export const config = {
  port: Number(req("PORT", "6969")),
  // Checked when the server starts (see checkStartupConfig), not on import,
  // so the routes that never touch Postgres can be loaded and tested alone.
  databaseUrl: process.env.DATABASE_URL ?? null,
  corsOrigins: req("CORS_ORIGINS", "http://127.0.0.1:6767,http://localhost:6767").split(","),
  frontendAppUrl: req("FRONTEND_APP_URL", "http://127.0.0.1:6767/globe-control/"),
  metricsMaxPerMinute: Number(req("METRICS_MAX_PER_MINUTE", "180")),
  locationVerifyMaxPerMinute: Number(req("LOCATION_VERIFY_MAX_PER_MINUTE", "40")),
  diagnosticsMaxPerMinute: Number(req("DIAGNOSTICS_MAX_PER_MINUTE", "120")),
  policyVersion: req("POLICY_VERSION", "vivet-v5"),
  maxmindCityDbPath: req("MAXMIND_CITY_DB_PATH", "./GeoLite2-City.mmdb"),
  maxmindAsnDbPath: req("MAXMIND_ASN_DB_PATH", "./GeoLite2-ASN.mmdb"),
  ipHashSalt: req("IP_HASH_SALT", DEV_SALT),
  trustProxyHops: Number(req("TRUST_PROXY_HOPS", "1")),
  schemaVersions: {
    settings: Number(req("SCHEMA_SETTINGS_VERSION", "2")),
    calibration: Number(req("SCHEMA_CALIBRATION_VERSION", "2")),
    locationPolicy: Number(req("SCHEMA_LOCATION_POLICY_VERSION", "2")),
    telemetry: Number(req("SCHEMA_TELEMETRY_VERSION", "2"))
  }
};

// Problems that should stop the server from starting at all.
export function checkStartupConfig(env = process.env, current = config) {
  const problems = [];
  if (!current.databaseUrl) {
    problems.push("DATABASE_URL is not set.");
  }
  // With the public default salt anyone can rebuild the IP behind a hash by
  // hashing all 4 billion IPv4 addresses, which defeats hashing them at all.
  if (env.NODE_ENV === "production" && current.ipHashSalt === DEV_SALT) {
    problems.push("IP_HASH_SALT must be set to a secret value in production.");
  }
  return problems;
}
