# Drive Safety Layer (v2.4)

## 1. Purpose

v2.4 adds non-destructive safety visibility around Google Drive operations before mutations can run. The layer provides:

- explicit OAuth health checks,
- read-only manifest/Drive drift detection,
- deduped drift-event logging,
- and mutation guardrails that block actions when auth is unhealthy.

## 2. Canonical startup command

Use this command for all local Drive/OAuth work:

```bash
npm run dev:or
```

This command loads `.env` before the OR service starts.

## 3. Auth health endpoint

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

## 4. Reconciliation endpoint

```bash
curl -s http://localhost:3030/api/drive/reconciliation
```

Expected read-only envelope:

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

The endpoint does not move files and does not mutate manifest state.

## 5. Mutation guard behavior

Blocked endpoints:

- `POST /api/drive/review/:drive_file_id/route`
- `POST /api/drive/sync`

If auth is unhealthy, response is HTTP `409` and includes:

```json
{
  "error": "Drive auth unhealthy",
  "reason": "OAuth credentials are incomplete",
  "auth": {
    "ready": false,
    "configured": false,
    "checkedAt": "2026-05-26T00:00:00.000Z"
  }
}
```

When blocked, the system must not:

- move Drive files,
- mutate manifest state,
- run sync fallback behavior,
- continue silently.

## 6. Replay/audit events

v2.4 emits:

- `drive_auth_health_checked`
- `drive_drift_detected`
- `drive_auth_unhealthy`

`drive_drift_detected` is deduped using a bounded cache per `(drive_file_id, type, expected.folder_path, actual.folder_path, mode)`.

## 7. No auto-remediation rule

v2.4 is a visibility-and-guardrail layer only.

Do not use this layer for:

- auto-remediation,
- reconciliation corrections,
- manifest repair,
- folder movement,
- route targeting changes,
- mutation retry/fallback behavior.

## 8. v2.4 validation checklist

Before merge/release closeout:

- `npm run check`
- `npm run test`
- Start with `npm run dev:or`
- `curl -s http://localhost:3030/api/drive/auth-health` shows `status: ready` and configured folders
- `curl -s http://localhost:3030/api/drive/reconciliation` returns read-only envelope
- `POST /api/drive/review/:drive_file_id/route` with unhealthy auth returns `409` + `Drive auth unhealthy`
- `POST /api/drive/sync` with unhealthy auth returns `409` + `Drive auth unhealthy`
- replay/audit shows `drive_auth_unhealthy` on blocked mutation attempts
