CREATE TABLE IF NOT EXISTS location_events (
  id BIGSERIAL PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id TEXT,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  coarse_lat NUMERIC,
  coarse_lng NUMERIC,
  ip_hash TEXT NOT NULL,
  trust_level NUMERIC NOT NULL,
  status TEXT NOT NULL,
  reason_codes JSONB NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_policy (
  id TEXT PRIMARY KEY,
  payload_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_location_events_profile ON location_events(profile_id);
CREATE INDEX IF NOT EXISTS idx_location_events_status ON location_events(status);