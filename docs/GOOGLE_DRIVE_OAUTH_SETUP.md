# Google Drive OAuth setup for Merlin OR (v1.6.1)

Use this flow when you need a `GOOGLE_REFRESH_TOKEN` for dedicated-drive sync.

## Prerequisites

- Google account dedicated to Merlin Drive
- Google Cloud project with **Google Drive API** enabled
- OAuth consent screen + OAuth client configured
- Local `.env` in `merlin-os-action-layer`:

```bash
MERLIN_DRIVE_MODE=oauth
MERLIN_DRIVE_SYNC_ENABLED=true
MERLIN_DRIVE_ROOT_MODE=dedicated_drive
MERLIN_DRIVE_ROOT_FOLDER_NAME=Merlin OR Storage
MERLIN_DRIVE_SYNC_MODE=manual
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://127.0.0.1:8765
```

## One-time refresh token workflow

1. Install/update dependencies:
   - `npm install`

2. Generate token:
   - `npm run drive:auth:token`

3. The script prints an authorization URL and waits:
   - paste the returned code manually, **or**
   - if using localhost redirect, copy the code automatically through callback.

4. The script outputs:
   - `GOOGLE_REFRESH_TOKEN=...`

5. Add it to local `.env`:
   - `GOOGLE_REFRESH_TOKEN=...`

6. Run the smoke test:
   - `npm run check`
   - `npm run test`
   - `npm run dev:or`

This ensures Drive OAuth credentials are loaded before server startup.

Then call:

```bash
curl http://localhost:3030/api/drive/status
curl -X POST http://localhost:3030/api/drive/sync
curl http://localhost:3030/api/drive/manifest
curl "http://localhost:3030/api/lisa/search?q=test"
curl http://localhost:3030/api/replay/recent
```

## Notes

- Do not commit `.env` or any token values.
- This helper reads credentials from local environment and `.env` only.
- You can revoke tokens in Google account security settings if needed.
- The helper requests full Drive scope (`https://www.googleapis.com/auth/drive`) so Merlin can read inbox files that were uploaded manually.

## Drive safety checks (v2.4)

Run Drive work only through the environment-loaded launcher:

```bash
npm run dev:or
```

Health check:

```bash
curl -s http://localhost:3030/api/drive/auth-health
```

Expected healthy response:

```json
{
  "status": "ready",
  "auth": {
    "ready": true,
    "configured": true
  },
  "managedFolders": {
    "ready": true,
    "missing": []
  }
}
```

Read-only drift check:

```bash
curl -s http://localhost:3030/api/drive/reconciliation
```

Expected read-only envelope includes:

```json
{
  "status": "ok",
  "mode": "read_only",
  "summary": {
    "checked": 0,
    "driftCount": 0,
    "blockingCount": 0,
    "warningCount": 0
  },
  "drift": []
}
```

Auth-unhealthy mutation behavior:

- `POST /api/drive/review/:drive_file_id/route`
- `POST /api/drive/sync`

Both endpoints return:

```json
{
  "error": "Drive auth unhealthy",
  "reason": "OAuth credentials are incomplete"
}
```

They do not move Drive files, mutate manifest state, run sync fallback, or continue silently.

v2.4 is audit-safe and read-only by default for reconciliation; no auto-remediation is added yet.
