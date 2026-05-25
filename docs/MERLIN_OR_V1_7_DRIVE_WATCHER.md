# Merlin OR v1.7 Drive Watcher

## Goal

Add an opt-in scheduled Drive sync runner that uses the same import path as manual sync.

## Runtime model

- Manual sync remains available through `POST /api/drive/sync`.
- Scheduled sync is disabled by default.
- Scheduled sync calls `syncDriveInbox()` and does not introduce a second ingestion path.

## Env

- `MERLIN_DRIVE_SYNC_ENABLED=true|false`
- `MERLIN_DRIVE_SYNC_MODE=manual|scheduled`
- `MERLIN_DRIVE_SYNC_INTERVAL_MINUTES=15`

Default behavior:

- Scheduler runs only when:
  - `MERLIN_DRIVE_SYNC_ENABLED=true`
  - `MERLIN_DRIVE_SYNC_MODE=scheduled`

## Safety rules

- Scheduler does not run imports when auth is not ready.
- Scheduler does not run when Drive sync is blocked.
- Blocked cases include:
  - `setup_required`
  - `folder_conflict`
- Normal sync does not create folders unless bootstrap flags explicitly allow it.

## Drive status additions

`GET /api/drive/status` now includes:

- `scheduler_enabled`
- `scheduler_interval_minutes`
- `last_scheduled_sync_at`
- `last_scheduled_sync_result`

## Notes

- No OCR added in v1.7.
- No external actions added.
- No new UI surface required beyond existing status output.
