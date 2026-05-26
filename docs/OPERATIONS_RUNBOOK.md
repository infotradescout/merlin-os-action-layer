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
