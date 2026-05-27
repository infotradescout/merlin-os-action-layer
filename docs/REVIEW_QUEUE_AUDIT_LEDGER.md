# Review Queue Audit Ledger (v2.13)

## Purpose

This ledger is the canonical release-grade record for Review Queue safety capabilities and authority boundaries.

It documents:

- which PR introduced each capability
- the merge SHA on `main`
- validation proof
- explicit safety boundaries

## Authority Boundary (Pinned)

The Review Queue stack currently has:

- review and audit authority
- metadata-only decision authority

The Review Queue stack does **not** have:

- Drive remediation authority
- manifest mutation authority
- folder create/delete authority
- permission repair authority
- new auth/roles authority

Client `decided_by` remains ignored as identity authority.
Server-derived attribution remains authoritative.
Timestamp query filters require strict RFC3339 UTC with `Z` suffix.

## Release Ledger

| Version | PR | Merge SHA on `main` | Capability Added | Validation | Safety Boundaries Preserved | Mutation Authority |
|---|---:|---|---|---|---|---|
| v2.4 Drive Safety Layer | #2 | `9bf4e66` | auth health endpoint, read-only reconciliation, drift dedupe, auth guardrails | `check` pass, `test` pass | read-only reconciliation, no auto-remediation | blocked when auth unhealthy |
| v2.5 Review Queue Operational UX/API | #3 | `6c10905` | review queue API + admin inbox + metadata-only decisions | `check` pass, `test` pass | no remediation actions, no manifest mutation | none added |
| v2.6 Runtime Hardening | #4 | `c379f50` | browser-level review queue proof + internal admin link + decision-history runtime behavior | `check` pass, `test` pass, `test:browser` pass | read-only and no-remediation language preserved | none added |
| v2.7 Persistence + Audit Trail | #5 | `2e831f9` | durable decision storage + item history API + audit API | `check` pass, `test` pass, `test:browser` pass | metadata-only persistence, no Drive/manifest mutation | none added |
| v2.8 Audit Export | #6 | `5b0c114` | JSON audit export endpoint + client helper + coverage | `check` pass, `test` pass, `test:browser` pass | export remains metadata-only | none added |
| v2.9 Operator Attribution | #7 | `cb44445` | attribution trust-boundary documentation + server-side authority rules | `check` pass, `test` pass, `test:browser` pass | client `decided_by` ignored, trusted context only | none added |
| v2.10 Auth-Context Adapter | #8 | `1d31626` | `operatorIdentity` adapter extraction, unchanged resolution order | `check` pass, `test` pass, `test:browser` pass | no auth-system expansion | none added |
| v2.11 Audit Filters + Query Controls | #9 | `f224f45` | `requestId/decidedBy/decision/from/to/limit` filters, validation, deterministic ordering | `check` pass, `test` pass, `test:browser` pass | read/query only | none added |
| v2.12 Export Evidence Pack | #10 | `0d0e321` | export evidence metadata (`generatedAt`, `recordCount`, `filterSummary`, `ordering`, `sourceEndpoint`) | `check` pass, `test` pass, `test:browser` pass | export envelope stays read-only and metadata-only | none added |
| v2.11.1 Strict Timestamp Patch | n/a (post-v2.12 main patch) | `0d2b7ba` | strict timestamp validation to align contract with implementation | `check` pass, `test` pass, `test:browser` pass | no endpoint/shape/authority expansion | none added |

## Capability Matrix

| Capability | Status | Introduced In | Notes |
|---|---|---|---|
| Drive auth health | ✅ | v2.4 | `GET /api/drive/auth-health` |
| Drive reconciliation (read-only) | ✅ | v2.4 | `mode: read_only` |
| Review Queue API | ✅ | v2.5 | queue + item + decision endpoints |
| Admin Review Queue UI | ✅ | v2.5 | operational inbox |
| Decision metadata-only writes | ✅ | v2.5 | no Drive/manifest mutation |
| Browser runtime proof | ✅ | v2.6 | Playwright coverage |
| Durable decision persistence | ✅ | v2.7 | SQLite-backed |
| Item history API | ✅ | v2.7 | `:itemId/history` |
| Audit API | ✅ | v2.7 | `/audit` |
| Export JSON | ✅ | v2.8 | `/audit/export.json` |
| Server-derived attribution | ✅ | v2.9 | trusted context precedence |
| Operator identity adapter | ✅ | v2.10 | `src/operatorIdentity.ts` |
| Query filters + controls | ✅ | v2.11 | request/operator/decision/time/limit |
| Evidence metadata envelope | ✅ | v2.12 | provenance fields |
| Strict timestamp validation | ✅ | v2.11.1 | RFC3339 UTC `Z` strictness |

## Endpoint Matrix

| Endpoint | Method | Purpose | Read/Write | Safety Contract |
|---|---|---|---|---|
| `/api/drive/auth-health` | GET | auth and managed-folder readiness | read | no mutation |
| `/api/drive/reconciliation` | GET | drift detection | read | `mode: read_only` |
| `/api/drive/review-queue` | GET | queue envelope and items | read | `mutationAllowed: false` |
| `/api/drive/review-queue/:itemId` | GET | queue item detail | read | no mutation |
| `/api/drive/review-queue/:itemId/decision` | POST | decision metadata record | metadata write | no Drive/manifest mutation |
| `/api/drive/review-queue/:itemId/history` | GET | item decision history | read | filterable, read-only |
| `/api/drive/review-queue/audit` | GET | audit trail listing | read | filterable, read-only |
| `/api/drive/review-queue/audit/export.json` | GET | evidence export | read | metadata-only envelope |
| `/admin/drive-review-queue` | GET | admin operational surface | read UI | no remediation controls |
| `/admin/drive-review-queue-client.js` | GET | typed client helper | read | no mutation semantics change |

## Validation Gate for This Ledger

Run:

```bash
npm run check
npm run test
npm run test:browser
git status --short
```

Expected:

- all validations pass
- working tree clean

