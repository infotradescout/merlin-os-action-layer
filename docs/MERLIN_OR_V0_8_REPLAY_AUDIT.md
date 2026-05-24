# Merlin OR v0.8 Replay / Audit Foundations

## Purpose

The v0.8 milestone adds a replay/audit layer so Merlin can explain the sequence of events between observed activity and outcomes.

## What this layer records

- event ingestion (`event_ingested`)
- state updates (`state_updated`)
- daily generation (`daily_generated`) event shape support
- recommendation creation (`recommendation_created`)
- policy evaluation (`policy_evaluated`)
- recommendation status updates (`recommendation_status_updated`)
- outcome recording (`outcome_recorded`)
- recommendation to outcome links (`outcome_linked`)

## API / response behavior

No new endpoints were added for v0.8.

Existing contracts remain unchanged:

- `GET /api/health`
- `GET /api/daily`
- `GET /api/search?q=`
- `GET /api/entities/:id/state`
- `GET /api/entities/:id/timeline`
- `GET /api/changes/recent`
- `POST /api/events/tradescout`

## How replay is used in the loop

- TradeScout ingestion emits replay events for event ingestion and state updates.
- Recommendation creation emits recommendation and policy replay events.
- Recommendation status updates emit replay events.
- Outcome recording emits outcome replay events.
- Recommendation/outcome linking emits outcome-link replay events.

## Tests

`tests/replay.test.ts` validates:

- generic event recording and lookup
- query by entity
- query by recommendation
- query by outcome
- recent ordering
- recommendation creation emits replay events
- outcome link emits replay event

## Configuration

Persistent runtime storage for LISA remains configured through:

- `MERLIN_DB_PATH` environment variable (default `./data/merlin-or.sqlite`)

Replay records are currently in-memory while runtime APIs and persistence are already handled in the LISA store layer.

## Limits and known gaps

- Replay does not yet provide external query endpoints.
- Replay data is volatile and does not currently persist across process restarts.
- Policy snapshots are captured as part of `policy_result` payload and stored with recommendation events.

## Next milestone

v0.9 is the minimal approval queue API.
