# Drive Review Queue (v2.5)

Canonical release ledger:

- [Review Queue Audit Ledger (v2.13)](/d:/AAATraderCorner/TradeScout/merlin-os-action-layer/docs/REVIEW_QUEUE_AUDIT_LEDGER.md)

## Purpose

v2.5 converts Drive reconciliation signals into an operational review workflow for operators.

- Route visibility for OAuth health and reconciliation state is exposed in one place.
- Drift items are represented as a read-only queue.
- Operators can record a decision for each queue item.
- No Drive mutation is performed from the queue workflow.

## Route

GET the admin route:

```bash
/admin/drive-review-queue
```

## Required API routes

- `GET /api/drive/auth-health`
- `GET /api/drive/reconciliation`
- `GET /api/drive/review-queue`
- `GET /api/drive/review-queue/:itemId`
- `POST /api/drive/review-queue/:itemId/decision`

## v2.5 guarantees

1. Read-only detection only

- Reconciliation remains read-only and reports drift in memory state.
- Queue items are derived from reconciliation results and sorted for operator review.

2. No remediation

- Queue decisions are workflow metadata only.
- There is no auto-create folder flow.
- There is no auto-delete folder flow.
- There is no auto-sync manifest/Drive state.
- There is no permission repair flow.

3. No Drive mutation path

- Decisions do not move Drive files.
- Decisions do not mutate Drive manifest records.
- Route is safe for review-only workflows.

4. Decision envelope safety

- `POST /api/drive/review-queue/:itemId/decision` updates decision metadata only.
- Queue response remains read-only with `mutationAllowed: false`.

## Validation checks (v2.5)

Before running operators, verify:

- Auth route: `curl -s http://localhost:3030/api/drive/auth-health`
- Reconciliation read-only mode: `curl -s http://localhost:3030/api/drive/reconciliation`
- Queue read-only envelope: `curl -s http://localhost:3030/api/drive/review-queue`
- Admin route returns HTML: `curl -I http://localhost:3030/admin/drive-review-queue`
- Queue client helper returns JS: `curl -I http://localhost:3030/admin/drive-review-queue-client.js`

Expected: `mutationAllowed` is false on queue payloads.

## Not included in v2.5

- Browser DOM/Playwright interaction test harness.
- Main app navigation placement for the admin panel.
- Auto-remediation buttons or workflow actions.
- Permission remediation.
- Drive folder repair or sync-trigger shortcuts from the queue UI.

## v2.6 runtime hardening addendum

v2.6 keeps all v2.5 guarantees intact and adds runtime-proof coverage:

- Browser interaction coverage for `/admin/drive-review-queue`.
- Decision history visibility in the queue item detail panel.
- Internal admin navigation access from Merlin Daily.

Validation command:

```bash
npm run test:browser
```

v2.6 still forbids:

- Drive remediation actions.
- Manifest mutation from queue decisions.
- Fix/repair/sync/create/delete/auto-resolve operator actions.

## v2.7 persistence and audit addendum

v2.7 adds durable review decision history and audit surfaces:

- `GET /api/drive/review-queue/:itemId/history`
- `GET /api/drive/review-queue/audit`
- `GET /api/drive/review-queue/audit/export.json`

Decision records are persisted as workflow metadata only with:

- `source: "drive_review_queue"`
- `mutationAllowed: false`

No Drive file movement, Drive remediation, or manifest mutation is performed by these APIs.

## v2.9 attribution addendum

Decision attribution uses existing request or environment context only:

- `x-operator-id`
- `x-operator-email`
- `x-user-id`
- `x-user-email`
- `x-forwarded-user`
- `MERLIN_OPERATOR_ID`

If no trusted source exists, `decidedBy` falls back to `unknown`.
Client-submitted `decided_by` is not treated as the authority.
Header-based attribution is intended for trusted internal or proxy-injected identity only.

## v2.10 auth-context adapter addendum

Attribution resolution is centralized in [src/operatorIdentity.ts](/d:/AAATraderCorner/TradeScout/merlin-os-action-layer/src/operatorIdentity.ts).

- `resolveOperatorIdentity(req)` returns:
  - `decidedBy`
  - `source` (`trusted_header`, `env`, `unknown`)
- Resolution order is unchanged:
  - `x-operator-id`
  - `x-operator-email`
  - `x-user-id`
  - `x-user-email`
  - `x-forwarded-user`
  - `MERLIN_OPERATOR_ID`
  - `unknown`
- This is not a new auth system.
- Client-submitted `decided_by` remains ignored as identity authority.

## v2.11 audit filters and query controls addendum

Read/query controls are available on existing history and audit routes only:

- `GET /api/drive/review-queue/:itemId/history`
- `GET /api/drive/review-queue/audit`
- `GET /api/drive/review-queue/audit/export.json`

Supported query params:

- `requestId` (exact match after trim)
- `decidedBy` (exact match after trim)
- `decision` (`acknowledged`, `needs_manual_review`, `false_positive`, `defer`, `resolved_externally`)
- `from` and `to` (ISO timestamp; inclusive range)
- `limit` (default `50`, max `100`)

Validation behavior:

- Invalid timestamps return `400`.
- `from > to` returns `400`.
- Invalid decision values return `400`.
- Invalid limit values return `400`.
- Unknown query params return `400`.

Safety remains unchanged:

- Query/filter controls are read-only.
- Attribution remains server-derived.
- No queue mutation behavior is added.
- No Drive or manifest mutation paths are added.

## v2.12 export hardening and evidence metadata addendum

`GET /api/drive/review-queue/audit/export.json` now includes an evidence metadata envelope for filtered exports:

- `generatedAt` (ISO timestamp)
- `recordCount` (number of returned records)
- `filterSummary` (normalized applied filters)
- `ordering` (`decidedAt_desc`)
- `sourceEndpoint` (`/api/drive/review-queue/audit/export.json`)

`exportedAt` remains for compatibility and mirrors `generatedAt`.

Example envelope fields:

- `mode: "read_only"`
- `mutationAllowed: false`
- `filterSummary.limit` bounded by v2.11 query controls

This remains metadata-only export behavior:

- no queue mutation
- no Drive or manifest mutation
- no remediation authority

## Runbook (operator flow)

1. Start with:

```bash
npm run dev:or
```

2. Confirm auth and read-only status:

```bash
curl -s http://localhost:3030/api/drive/auth-health
curl -s http://localhost:3030/api/drive/reconciliation
curl -s http://localhost:3030/api/drive/review-queue
```

3. Open review queue:

```text
http://localhost:3030/admin/drive-review-queue
```

4. For any queue item, choose one decision action only:

- `acknowledged`
- `needs_manual_review`
- `false_positive`
- `defer`
- `resolved_externally`

5. If auth is unhealthy, decision actions should be blocked and no mutations should happen.
