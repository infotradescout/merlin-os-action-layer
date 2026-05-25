# Merlin OR v1.6.1 Drive Real-Connection Smoke Test

## Goal

Validate the dedicated Google Drive manual sync path end-to-end before enabling any scheduled watcher.

The test confirms:

- real Drive credentials can authenticate,
- `00_Inbox` files are discovered,
- manifest is written,
- import routing is applied,
- replay/audit is recorded,
- LISA search can find imported records.

## Required .env values

Set these in your local environment (or shell):

- `MERLIN_DRIVE_MODE=oauth`
- `MERLIN_DRIVE_SYNC_ENABLED=true`
- `MERLIN_DRIVE_ROOT_MODE=dedicated_drive`
- `MERLIN_DRIVE_ROOT_FOLDER_NAME=Merlin OR Storage`
- `MERLIN_DRIVE_SYNC_MODE=manual`
- `GOOGLE_CLIENT_ID=...`
- `GOOGLE_CLIENT_SECRET=...`
- `GOOGLE_REDIRECT_URI=...`
- `GOOGLE_REFRESH_TOKEN=...`

If you want, also set:

- `MERLIN_DRIVE_ROOT_FOLDER_ID=<optional>`

> Keep all secrets out of Git. Use `.env` only in local development.

## Required folder structure (dedicated drive root)

At minimum, confirm these folders exist in the dedicated account:

- `00_Inbox`
- `01_Processed`
- `02_Needs_Review`
- `03_Archived_Sources`
- `04_Entity_Files`
- `05_Exports`
- `06_Audit`
- `07_System`

## Test file setup

1. Place one file into `00_Inbox`, for example:
   - `test-note.txt`
2. If you want the file to route to `processed`, include enough context for entity mapping (if required by current sync rules).

## Runtime checks

Run:

```bash
npm run check
npm run test
npm run dev
```

In another terminal:

1. Trigger sync:

```bash
curl -X POST http://localhost:3030/api/drive/sync
```

2. Verify driver and sync status:

```bash
curl http://localhost:3030/api/drive/status
```

Expected debug fields should include:

- `status: "ready"` or explicit reason
- `auth.configured`
- `auth.ready`
- `managed_folders` IDs/paths for each required folder
- `bootstrap_plan` with missing/reusable folders
- `sync_mode`

3. Verify manifest entries:

```bash
curl "http://localhost:3030/api/drive/manifest"
```

Expected:

- a new manifest row for the test file
- `status` should be one of `processed`, `needs_review`, or `skipped`
- if processed, `created_4data_event_id` is expected

4. Search LISA:

```bash
curl "http://localhost:3030/api/lisa/search?q=test"
```

Expected:

- results include the imported file / drive manifest / related replay record

5. Verify replay trail:

```bash
curl "http://localhost:3030/api/replay/recent"
```

Expected:

- a `drive_import_received` event
- one of:
  - `drive_import_processed`
  - `drive_import_needs_review`
  - `drive_import_skipped`

## KPI pass criteria

Real smoke test is successful only if all are true:

- file is found in `00_Inbox`
- manifest entry is created
- file is routed (`01_Processed` or `02_Needs_Review`) if applicable
- replay event(s) are recorded
- LISA search finds the imported artifact
- no unrelated Drive content is moved

## Rollback/cleanup

- Remove `test-note.txt` from Google Drive after validation
- Optionally call:

```bash
curl -X POST http://localhost:3030/api/demo/reset
```

for an environment reset of in-memory/runtime demo entities.

## Next milestone

After this passes once with real credentials, proceed to:

- `v1.7 — Scheduled Drive Watcher`

with manual sync still required as the baseline/ground-truth path.
