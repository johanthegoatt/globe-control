ALTER TABLE session_metrics
  ADD COLUMN IF NOT EXISTS latency_ms NUMERIC,
  ADD COLUMN IF NOT EXISTS pinch_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pinch_successes INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS false_orbit_count INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS app_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_events_session ON app_events(session_id);
CREATE INDEX IF NOT EXISTS idx_app_events_ts ON app_events(ts);
