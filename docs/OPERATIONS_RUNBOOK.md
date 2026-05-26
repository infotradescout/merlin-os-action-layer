# Operations Runbook

## Drive operation safety and review

This runbook captures v2.4 + v2.5 run checks used for operational handoff.

### 1) OAuth / safety baseline (v2.4)

```bash
npm run dev:or
curl -s http://localhost:3030/api/drive/auth-health
curl -s http://localhost:3030/api/drive/reconciliation
```

- Expect OAuth/managed-folder readiness for safe mutation.
- Reconciliation is read-only.

### 2) Review queue route (v2.5)

```bash
curl -s http://localhost:3030/api/drive/review-queue
curl -I http://localhost:3030/admin/drive-review-queue
curl -I http://localhost:3030/admin/drive-review-queue-client.js
```

- Queue response must remain read-only.
- UI is an operational inbox for decisions only.

### 3) Decision workflow checks

Decision endpoints are workflow metadata only:

```bash
curl -s http://localhost:3030/api/drive/review-queue/:itemId
curl -s -X POST http://localhost:3030/api/drive/review-queue/:itemId/decision \
  -H 'Content-Type: application/json' \
  -d '{"decision":"acknowledged"}'
```

### 4) v2.5 non-goals (must not be added in this layer)

- Auto-repair/autofix actions.
- Folder repair or Drive mutation from queue decisions.
- Browser DOM/Playwright harness.
- Main app navigation wiring.

### 5) v2.6 runtime hardening checks

Browser-level queue interaction is now covered with:

```bash
npm run test:browser
```

Coverage includes:

- `/admin/drive-review-queue` route load.
- Auth strip and reconciliation summary rendering.
- Queue item selection and detail display.
- Decision post with metadata-only payload.
- Post-decision UI update and decision-history visibility.
- No remediation wording in the admin inbox surface.

### 6) v2.7 persistence + audit checks

Verify decision history persistence and audit visibility:

```bash
curl -s http://localhost:3030/api/drive/review-queue/:itemId/history
curl -s "http://localhost:3030/api/drive/review-queue/audit?limit=100"
curl -s "http://localhost:3030/api/drive/review-queue/audit/export.json?limit=100"
```

Expected:

- `mode` remains `read_only`.
- `mutationAllowed` remains `false`.
- History/audit records contain workflow metadata only (`decision`, `note`, `decidedAt`, `decidedBy`, `source`).
- No remediation behavior is exposed.
