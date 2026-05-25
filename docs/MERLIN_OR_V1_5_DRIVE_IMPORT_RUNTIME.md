# Merlin OR v1.5 Drive Import Runtime

## What this milestone adds

v1.5 introduces a manual/runtime-only Google Drive import path so Drive files can enter LISA without OAuth yet.

Flow:

- POST Drive metadata to `POST /api/drive/import-file`.
- Merlin creates a `DriveFileRecord`.
- Merlin creates a persistent `Drive` manifest entry.
- Merlin evaluates whether the file is processable.
- If processable, Merlin creates a `drive_file_imported` LISA record.
- If not processable, Merlin marks the manifest entry as `needs_review` or `skipped`.
- Replay events capture import lifecycle progress.

## Endpoints

- `POST /api/drive/import-file`
- `GET /api/drive/manifest`
- `GET /api/drive/manifest/:drive_file_id`
- `GET /api/drive/needs-review`

## Manifest status rules

- `pending` / `seen` / `inbox`: staged but not yet ingested into LISA
- `processed`: ingested into LISA as a `drive_file_imported` event
- `needs_review`: requires human review (for example, folder indicates review or missing entity context)
- `skipped`: unsupported or low-confidence file for LISA ingest
- `failed`: runtime failure while creating manifest/state

## Read path and visibility

- Processed Drive imports surface in:
  - `/api/lisa/search`
  - `/api/lisa/events`
  - daily derivation (current mappings place imports in `changed` by default)
- All manifest activity is searchable via existing LISA Browser search through manifest rows and LISA events.

## Replay/audit

Import lifecycle emits replay types:

- `drive_import_received`
- `drive_import_processed`
- `drive_import_skipped`
- `drive_import_needs_review`
- `drive_import_failed`

## Demo/state behavior

- `POST /api/demo/reset` clears import/runtime state in non-production mode.
- Existing v1.1+ demo reset behavior is preserved.

## Non-goals for v1.5

- No OAuth
- No Google API calls
- No background watcher cron/poller yet

OAuth and polling are reserved for v1.8.
