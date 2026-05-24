# Merlin OR v1.1 Demo Seed & Reset

## What it does

The v1.1 flow adds local/dev-only endpoints that make the Merlin Daily demo reproducible without manual `curl` payloads.

- Seed a realistic TradeScout loop into the current runtime store.
- Reset all local demo state back to empty.
- Keep all existing response shapes unchanged for existing endpoints.

## Demo endpoints

- `POST /api/demo/seed-tradescout-loop`
- `POST /api/demo/reset`

These endpoints are enabled only in non-production mode (`NODE_ENV` and `MERLIN_RUNTIME` must not be `production`).

## Seed payload behavior

The seed endpoint injects these TradeScout-style events through the existing ingestion path:

- `business_profile_claimed`
- `verification_document_uploaded`
- `contact_request_created`
- `quote_sent`
- `contact_request_stale`
- `job_outcome_recorded`

They flow through:

- LISA runtime ingestion
- entity state persistence
- entity timeline
- recent changes
- daily section calculation
- recommendation creation
- approval queue creation (where policy requires approval)
- replay/audit event creation

## Demo script

1. Start server: `npm run dev`.
2. Open root UI at `http://localhost:3030/`.
3. Clear current data:
   - `POST /api/demo/reset`
4. Seed the demo loop:
   - `POST /api/demo/seed-tradescout-loop`
5. Refresh Daily and approval views:
   - `GET /api/daily`
   - `GET /api/approvals`

Optional checks:

- `GET /api/changes/recent`
- `GET /api/replay/recent`
- `GET /api/entities/business_demo_001/state`
- `GET /api/entities/business_demo_001/timeline`

## Notes

- This is strictly for local development and partner demos.
- No auth, voice, payments, external actions, or production data behavior is introduced.
- This is intentionally synthetic data to demonstrate the current OR loop.
