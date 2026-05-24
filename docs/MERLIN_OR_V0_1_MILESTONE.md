# Merlin OR v0.1 Milestone (v0.2 implemented)

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
- **v0.2 persistent store** for LISA runtime data in SQLite.

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
curl http://localhost:3030/api/entities/business_001/state
curl http://localhost:3030/api/entities/business_001/timeline
```

Run verification with:

```bash
npx tsx --test tests/api-v0.test.ts
npx tsx --test tests/api-v0-persistence.test.ts
```

## Endpoints

- `GET /api/health`
- `GET /api/daily`
- `GET /api/search?q=`
- `GET /api/entities/:id/state`
- `GET /api/entities/:id/timeline`
- `GET /api/changes/recent`
- `POST /api/events/tradescout`

## Configuration

- Default SQLite path: `./data/merlin-or.sqlite`
- Override path with `MERLIN_DB_PATH`

## Verified commands

```bash
npm install
npx tsc -p tsconfig.json --noEmit
npx tsx --test tests/api-v0.test.ts
npx tsx --test tests/api-v0-persistence.test.ts
```

## Known limitations

- No auth yet.
- No UI yet.
- No real TradeScout webhook integration yet.
- No production deployment config yet.
- No Merlin approval queue yet.
- No FactDeck integration yet.

## Next milestone

Merlin OR v0.3: real TradeScout emitter integration.

Planned v0.3 priorities:

- Receive TradeScout events from a production webhook source.
- Maintain existing APIs and keep persistence behavior stable.
- Keep event-to-state derivation deterministic for deterministic operational use.

