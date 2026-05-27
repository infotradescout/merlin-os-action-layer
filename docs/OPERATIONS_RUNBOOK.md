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

Attribution behavior:

- Server resolves `decidedBy` from trusted context (`x-operator-id`, `x-operator-email`, `x-user-id`, `x-user-email`, `x-forwarded-user`, or `MERLIN_OPERATOR_ID`).
- If none is present, `decidedBy` is `unknown`.
- Client-submitted `decided_by` is not the authority.
- Header-based attribution assumes trusted infrastructure strips spoofed external headers before injection.

### 7) v2.10 auth-context adapter note

Attribution lookup is centralized in [src/operatorIdentity.ts](/d:/AAATraderCorner/TradeScout/merlin-os-action-layer/src/operatorIdentity.ts) so future session identity can plug in without changing review-queue safety logic.

- This does not introduce a new auth system or roles.
- Resolution order and fallback behavior are unchanged.

### 8) v2.11 audit query controls

Use read-only filters on existing endpoints:

```bash
curl -s "http://localhost:3030/api/drive/review-queue/audit?requestId=<requestId>&limit=50"
curl -s "http://localhost:3030/api/drive/review-queue/audit?decidedBy=ops@tradescout.local&decision=acknowledged&limit=50"
curl -s "http://localhost:3030/api/drive/review-queue/audit?from=2026-05-01T00:00:00.000Z&to=2026-05-26T23:59:59.999Z&limit=50"
curl -s "http://localhost:3030/api/drive/review-queue/audit/export.json?decision=defer&limit=50"
curl -s "http://localhost:3030/api/drive/review-queue/<itemId>/history?decision=acknowledged&limit=25"
```

Query rules:

- `requestId`, `decidedBy`: exact match after trim.
- `decision`: one of `acknowledged`, `needs_manual_review`, `false_positive`, `defer`, `resolved_externally`.
- `from`/`to`: ISO timestamps only, inclusive.
- `limit`: integer, default `50`, max `100`.
- Unknown query params are rejected with `400`.

This layer remains read-only and does not introduce remediation or mutation behavior.

### 9) v2.12 export evidence metadata

Hardened export now includes provenance metadata for filtered evidence packs:

```bash
curl -s "http://localhost:3030/api/drive/review-queue/audit/export.json?requestId=<requestId>&decidedBy=ops@tradescout.local&decision=acknowledged&from=2026-05-01T00:00:00.000Z&to=2026-05-26T23:59:59.999Z&limit=25"
```

Expected export fields:

- `generatedAt` (ISO timestamp)
- `recordCount` (bounded result count)
- `filterSummary` (normalized requestId/decidedBy/decision/from/to/limit)
- `ordering: "decidedAt_desc"`
- `sourceEndpoint: "/api/drive/review-queue/audit/export.json"`
- `mode: "read_only"`
- `mutationAllowed: false`

`exportedAt` is preserved for compatibility and equals `generatedAt`.
