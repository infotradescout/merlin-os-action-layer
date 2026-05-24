# Merlin OR v0.1 Milestone

## Status

Implemented and validated.

## What works

- Runtime boots locally.
- `/api/health` returns service status.
- Empty `/api/daily` returns empty sections.
- Empty `/api/changes/recent` returns empty array.
- `POST /api/events/tradescout` accepts TradeScout activity.
- Posted events create LISA records.
- Entity state reflects posted events.
- Entity timeline reflects posted events.
- Recent changes reflect posted events.
- Merlin Daily reflects event-derived activity.
- TradeScout event aliases normalize into supported LISA signal types.
- API v0 tests pass.

## How to run it

```bash
npm install
npx tsc -p tsconfig.json --noEmit
npm run dev
```

API smoke checks:

```bash
curl http://localhost:3030/api/health
curl http://localhost:3030/api/daily
curl http://localhost:3030/api/changes/recent
```

Run verification with:

```bash
npx tsx --test tests/api-v0.test.ts
```

## Endpoints

- `GET /api/health`
- `GET /api/daily`
- `GET /api/search?q=`
- `GET /api/entities/:id/state`
- `GET /api/entities/:id/timeline`
- `GET /api/changes/recent`
- `POST /api/events/tradescout`

## Verified commands

```bash
npm install
npx tsc -p tsconfig.json --noEmit
npm run dev
npx tsx --test tests/api-v0.test.ts
```

### Manual smoke sequence

```bash
curl -X POST http://localhost:3030/api/events/tradescout \
  -H "Content-Type: application/json" \
  -d '{
    "entity_id": "business_001",
    "event_type": "verification_document_uploaded",
    "origin_surface": "tradescout",
    "observed_at": "2026-05-23T14:49:00.000Z",
    "payload": {
      "document_type": "insurance",
      "status": "needs_review"
    }
  }'

curl http://localhost:3030/api/entities/business_001/state
curl http://localhost:3030/api/entities/business_001/timeline
curl http://localhost:3030/api/changes/recent
curl http://localhost:3030/api/daily
```

## Known limitations

- LISA runtime store is still in-memory.
- No auth yet.
- No UI yet.
- No persistent database yet.
- No real TradeScout webhook integration yet.
- No production deployment config yet.
- No Merlin approval queue yet.
- No FactDeck integration yet.

## Next milestone

Merlin OR v0.2: persistent LISA store.

## v0.2 target

- Store events persistently.
- Preserve entity state across restarts.
- Preserve timeline across restarts.
- Add append-only event model.
- Keep current endpoints stable.
- Add migration / setup command.

## Then v0.2 begins

The next actual build is:

> **persistent LISA store**

Not UI.

Reason: if it stays in-memory, it is only a demo. Persistence makes it product infrastructure.

## v0.2 technical choice

For speed, use **SQLite first**, not Postgres.

Why:

```text
faster local development
simple file-based persistence
no deployment dependency yet
easy tests
easy migration later to Postgres
```

Use:

- better-sqlite3

or, if async/future-proof is preferred:

- sqlite + drizzle

Recommended:

- better-sqlite3 for v0.2
- Postgres later when multi-user/cloud deployment is real

## v0.2 tables

Minimum:

- `events`
- `entities`
- `entity_state`
- `entity_timeline`
- `recent_changes`

Do not overbuild the full substrate yet.

For v0.2, store only what the current API needs.

