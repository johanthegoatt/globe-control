# globe-control backend

## Prerequisites
- Node.js 18+
- PostgreSQL 16 (or use docker-compose)

## Setup
1. Copy env:
   - `cp .env.example .env`
2. Install deps:
   - `npm install`
3. Start Postgres (optional docker):
   - `docker compose up -d`
4. Run migration:
   - `npm run migrate`
5. Start API:
   - `npm run dev`

Server: `http://127.0.0.1:6969`
Health: `GET /api/v1/health`
Runtime: `GET /api/v1/config/runtime`

## Endpoints
- `GET /api/v1/profile/:profileId`
- `PUT /api/v1/profile/:profileId/settings`
- `GET /api/v1/profile/:profileId/calibration`
- `PUT /api/v1/profile/:profileId/calibration`
- `POST /api/v1/session/start`
- `POST /api/v1/session/:sessionId/metrics`
- `POST /api/v1/session/:sessionId/events`
- `GET /api/v1/session/:sessionId/summary`
- `POST /api/v1/session/:sessionId/end`
- `POST /api/v1/location/verify`
- `POST /api/v1/location/verify/retry`
- `POST /api/v1/location/focus/validate`
- `GET /api/v1/location/policy`

## Notes
- CORS origins are controlled by `CORS_ORIGINS`.
- Metrics endpoint is rate limited by `METRICS_MAX_PER_MINUTE`.
- Diagnostics endpoint is rate limited by `DIAGNOSTICS_MAX_PER_MINUTE`.
- Location verification endpoint is rate limited by `LOCATION_VERIFY_MAX_PER_MINUTE`.
- Raw IP is never stored in DB rows; only hashed IP is persisted.

## Known Failure Modes
- Camera denied: frontend stays usable but no tracking session starts.
- Backend unreachable: frontend falls back to local mode and reports `backend_unreachable`.
- Geolocation denied: location pin flow fails safely with explicit status.
- Weak lighting or hand occlusion: tracking may transition to `searching/lost` with suppression reasons.

## Capstone Demo Checklist
1. Confirm backend health `GET /api/v1/health` returns `ok: true`.
2. Confirm runtime config `GET /api/v1/config/runtime` matches expected ports/origins.
3. Start frontend at `http://127.0.0.1:6767/globe-control/`.
4. Verify hand tracking states transition `searching -> locked`.
5. Verify pinch zoom and orbit suppression while pinching.
6. Verify location pin for `verified`, `needs_review`, and `blocked` paths.
7. Capture session summary via `GET /api/v1/session/:sessionId/summary`.
8. Stop session cleanly and confirm no 5xx responses in logs.

## Maintenance Recommendation
- Run periodic cleanup for high-volume telemetry tables (`session_metrics`, `app_events`) using a scheduled DB job based on retention policy.
