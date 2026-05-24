# Merlin OR v1.2 Persistence

## Scope

v1.2 hardens the runtime loop with SQLite persistence for core OR runtime data so
state survives process restart.

The persisted surfaces now include:

- LISA events
- entity state
- timeline entries
- recommendations
- approvals
- outcomes
- replay events
- Drive manifest entries

## Configuration

Merlin uses a SQLite database path from:

- `MERLIN_DB_PATH` (override)
- default: `./data/merlin-or.sqlite`

The `data/` directory is created automatically when first initialized.

## Restart behavior

Because the runtime data is persisted, a demo flow can be started, recorded, and
reloaded from disk after a restart with:

- `entity_state`
- `timeline_entries`
- `recommendations`
- `approvals`
- `outcomes`
- `replay_events`
- `drive_manifest_entries`

still available and queryable immediately after the store is re-initialized.

## Demo reset behavior

`POST /api/demo/reset` is non-production-only and clears the persisted demo
runtime state (store-backed tables) for the same database path.

## What remains in-memory

The following behavior is intentionally still test-memory or process-local:

- test-only reset helpers
- source/indexing helpers that are not yet moved to persistence in this release

## Runbook

1. Set `MERLIN_DB_PATH` for your environment.
2. Start the server and ingest events.
3. Restart the process.
4. Confirm `/api/daily` and `/api/changes/recent` still show prior data.
