# Merlin OR v0.5 Outcome Tracker Milestone

## Status

Implemented as a local in-memory foundation.

## What works

- Added `src/outcomes.ts` with v0.5 outcome-tracking primitives.
- Outcomes support canonical statuses:
  - `suggested`
  - `accepted`
  - `dismissed`
  - `completed`
  - `failed`
  - `unknown`
- Outcomes support minimum outcome types:
  - `customer_replied`
  - `document_reviewed`
  - `follow_up_sent`
  - `job_booked`
  - `quote_accepted`
  - `quote_rejected`
  - `no_response`
  - `manual_done`
- Recommendation records can be created and default to `suggested` status.
- Outcome records can be linked to:
  - `entity_id`
  - `signal_id` (when available)
  - `recommendation_id` (when available)
- Query helpers are available:
  - `getOutcomesForEntity(entity_id)`
  - `getOutcomeById(id)`
  - `getRecentOutcomes(limit)`
- Added deterministic reset hook: `resetOutcomesForTest()`.
- Added tests for recommendation creation, accepted/dismissed/completed outcomes, entity query, ordering, and unknown fallback.

## Why this matters

v0.4 let Merlin keep one business in one entity lane.

v0.5 adds the missing learning signal: whether suggested actions were accepted, dismissed, completed, or failed.

This is the foundation for confidence updates, recommendation optimization, and a real closed-loop runtime.

## Known limitations

- In-memory only (no persistence yet).
- No API endpoints yet (`POST /api/outcomes` and `GET /api/entities/:id/outcomes` are pending).
- No score decay/improvement logic yet.
- No UI or auth.

## Milestone command set

Run these to validate v0.5:

```bash
npm run check
npm run test
npx tsx --test tests/outcomes.test.ts
npx tsx --test tests/api-v0.test.ts
npx tsx --test tests/entity-resolution.test.ts
npx tsx --test tests/source-registry.test.ts tests/freshness.test.ts
```

## Next milestone

v0.6 outcome behavior foundation: confidence updates and outcome-linked suggestion scoring.
