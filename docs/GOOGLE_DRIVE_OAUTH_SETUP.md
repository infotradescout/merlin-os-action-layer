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
