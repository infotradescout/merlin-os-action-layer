# Merlin / MealScout Intake Action-Card Contract Classification

Date: 2026-06-15

## Scope

- Repo: `Merlin / merlin-os-action-layer`
- Branch: `main`
- Required HEAD: `ca4d6f8ed8c7fbc1fdf434a1af41ddf1488421a6`
- Lane type: read-only diagnostic classification

## Git State

- Branch before inspection: `main`
- HEAD before inspection: `ca4d6f8ed8c7fbc1fdf434a1af41ddf1488421a6`
- Git status before inspection: `## main...origin/main`
- Files edited during inspection: one report artifact only
- Runtime/test/schema/data/apply/screenshot/export/deploy changes made: no

## Inputs Inspected

- `tests/merlin-intake-action-cards-dryrun.test.ts`
- `tests/merlin-intake-action-cards-runtime.test.ts`
- `src/server.ts`
- `src/merlin/intake/actionCardQueue.ts`
- `src/merlin/routes/merlinActionCardRoutes.ts`
- `src/merlin/routes/merlinIntakeRoutes.ts`
- `src/merlin/routes/merlinDryRunExecutorRoutes.ts`
- route inventory across `src/merlin/routes/*`

## Route Mount Map

Primary mount points in `src/server.ts`:

| Source | Mounted path or condition | Notes |
| --- | --- | --- |
| `src/server.ts:1760` | `GET /api/merlin/search` | Mounted through `handleMerlinSearchRoute` |
| `src/server.ts:1765` | `/api/merlin/intake` and `/api/merlin/intake/*` | Mounted through `handleMerlinIntakeRoute` |
| `src/server.ts:1778` | `/api/merlin/action-cards*` | Mounted through `handleMerlinActionCardRoute` |
| `src/server.ts:2383` | `POST /api/mealscout/intake/preview` | Inline handler in `server.ts` |
| `src/server.ts:3681-3777` | `/api/mealscout/intake/affiliate-attribution/*` | Separate affiliate-attribution action-card surface |

Relevant Merlin-native route definitions:

| File | Registered routes |
| --- | --- |
| `src/merlin/routes/merlinActionCardRoutes.ts:41-140` | `POST /api/merlin/action-cards`, `GET /api/merlin/action-cards`, `GET /api/merlin/action-cards/:id`, `PATCH /api/merlin/action-cards/:id/decision`, `GET /api/merlin/action-cards/:id/history` |
| `src/merlin/routes/merlinIntakeRoutes.ts:99-320` | Merlin intake upload-intent and intake generation routes under `/api/merlin/intake/*` |
| `src/merlin/routes/merlinDryRunExecutorRoutes.ts:43-119` | Merlin dry-run execution routes under `/api/merlin/dry-run-executions/*` |

Relevant MealScout-branded route evidence:

- `src/server.ts:2383` registers `POST /api/mealscout/intake/preview`.
- `src/server.ts:3787` returns `actionCards` only for affiliate-attribution: `getMealScoutAffiliateAttributionActionCards(...)`.
- No source registration was found for `/api/mealscout/intake/action-cards*`.
- No source registration was found for `/api/mealscout/intake/batches/:batchId/action-cards`.
- No source registration was found for `/api/mealscout/intake/notifications/:id/open`.

## Endpoint Registration Table

| Endpoint under test | Source evidence | Registration state | Classification |
| --- | --- | --- | --- |
| `GET /api/mealscout/intake/batches/:batchId/action-cards` | No matching route in `src/server.ts` or `src/merlin/routes/*`; queue helper exists as `listActionCardsByBatch` in `src/merlin/intake/actionCardQueue.ts:752` | Missing | `Ghost Route` |
| `GET /api/mealscout/intake/action-cards` | No matching route; Merlin-native list exists only at `/api/merlin/action-cards` in `src/merlin/routes/merlinActionCardRoutes.ts:84` | Missing | `Ghost Route` |
| `POST /api/mealscout/intake/action-cards/:id/dry-run` | No matching route; no MealScout-branded dry-run handler found | Missing | `Ghost Route` |
| `PATCH /api/mealscout/intake/action-cards/:id/decision` | No matching route; Merlin-native decision handler exists only at `/api/merlin/action-cards/:id/decision` in `src/merlin/routes/merlinActionCardRoutes.ts:105` | Missing | `Ghost Route` |
| `POST /api/mealscout/intake/action-cards/:id/apply` | No matching route found | Missing | `Ghost Route` |
| `POST /api/mealscout/intake/action-cards/:id/notification/preview` | No matching route found | Missing | `Ghost Route` |
| `POST /api/mealscout/intake/action-cards/:id/notification/send` | No matching route found | Missing | `Ghost Route` |
| `GET /api/mealscout/intake/action-cards/:id/notification/status` | No matching route found | Missing | `Ghost Route` |
| `PATCH /api/mealscout/intake/action-cards/:id/notification/recipient` | No matching route found | Missing | `Ghost Route` |
| `POST /api/mealscout/intake/action-cards/:id/contact-evidence` | No matching route found | Missing | `Ghost Route` |
| `GET /api/mealscout/intake/notifications/:trackingId/open` | No matching route found | Missing | `Ghost Route` |
| `POST /api/mealscout/intake/preview` | Registered inline in `src/server.ts:2383` | Present | Separate analysis below |

## Test-to-Route Correlation

### `tests/merlin-intake-action-cards-dryrun.test.ts`

This file seeds the queue store directly through `rememberActionCards(...)` from `src/merlin/intake/actionCardQueue.ts:427` and then calls MealScout-branded intake action-card endpoints.

| Test surface | Queue/store source exists | HTTP route source exists | Result |
| --- | --- | --- | --- |
| Batch listing | yes | no | queue-backed contract is not mounted |
| List by card | yes | no | queue-backed contract is not mounted |
| Dry-run preview per card | partial backing data exists | no | no route surface |
| Decision updates | yes via `updateActionCardDecision` at `src/merlin/intake/actionCardQueue.ts:566` | no MealScout route | no route surface |
| Apply state | yes via `updateActionCardApplyState` at `src/merlin/intake/actionCardQueue.ts:585` | no MealScout route | no route surface |
| Notification preview/send/status/open | yes via notification fields and `updateActionCardNotificationState` at `src/merlin/intake/actionCardQueue.ts:613` | no MealScout route | no route surface |
| Manual recipient override | yes via `updateActionCardManualRecipient` at `src/merlin/intake/actionCardQueue.ts:668` | no MealScout route | no route surface |
| Contact evidence add-on | yes via `updateActionCardContactEvidence` at `src/merlin/intake/actionCardQueue.ts:704` | no MealScout route | no route surface |

### `tests/merlin-intake-action-cards-runtime.test.ts`

This file does not seed the queue directly. It relies on `POST /api/mealscout/intake/preview` to return an `actionCards` array and then uses the returned card id for a later `/api/mealscout/intake/action-cards/:id/dry-run` call.

| Test expectation | Source evidence | Result |
| --- | --- | --- |
| `preview` returns `actionCards` array | `src/server.ts:2480-2562` returns `evidenceFiles`, `clusters`, `drafts`, `unattachedMedia`, `mergeAssist`, `fieldCorrections`, `attachmentDecisions`, `publishPlan`, `affiliateAttributionKpis`, `summary`; no `actionCards` field is returned | live route with drifted payload |
| returned action-card id can be dry-run inspected | no MealScout-branded dry-run route exists | downstream route also missing |

## Failure Classification Table

### Action-card endpoint failures

| Failure group | Classification | Source basis |
| --- | --- | --- |
| `/api/mealscout/intake/batches/:batchId/action-cards` | `Ghost Route` | no registration found; queue helper exists but is unmounted |
| `/api/mealscout/intake/action-cards` | `Ghost Route` | no registration found; Merlin-native list exists at different prefix |
| `/api/mealscout/intake/action-cards/:id/dry-run` | `Ghost Route` | no registration found |
| `/api/mealscout/intake/action-cards/:id/decision` | `Ghost Route` | no registration found; only `/api/merlin/action-cards/:id/decision` exists |
| `/api/mealscout/intake/action-cards/:id/apply` | `Ghost Route` | no registration found |
| `/api/mealscout/intake/action-cards/:id/notification/*` | `Ghost Route` | queue fields exist, but no HTTP routes are mounted |
| `/api/mealscout/intake/action-cards/:id/contact-evidence` | `Ghost Route` | queue update helper exists, but no HTTP route is mounted |
| `/api/mealscout/intake/notifications/:trackingId/open` | `Ghost Route` | no registration found |

### Preview `actionCards` failures

| Failure group | Classification | Source basis |
| --- | --- | --- |
| `POST /api/mealscout/intake/preview` missing `actionCards` in response body | `Drifted Contract` | route is present, but current response shape in `src/server.ts:2480-2562` is draft-centric and omits `actionCards` entirely |

## Preview `actionCards` Response-Shape Analysis

The preview route is live and not returning a generic 404. Source inspection shows:

- It accepts MealScout screenshot inputs and optional Drive-folder loading.
- It builds `evidenceFiles`, `clusters`, `drafts`, `unattachedMedia`, `mergeAssist`, and `publishPlan`.
- It returns `mutationAllowed: false`.
- It does not return `actionCards`.

This means the preview failures are not caused by route absence. They are caused by a response-shape mismatch between the current implementation and the test contract.

Source evidence does not prove that the tests are stale by design. It only proves the runtime no longer satisfies the tested shape. That keeps this bucket in `Drifted Contract`, not `Stale Test`.

## Suspected Root Cause

Source evidence supports a two-part drift:

1. The MealScout-branded intake action-card HTTP surface appears to have been dropped or never re-mounted after the queue/store layer was introduced.
2. The MealScout preview endpoint evolved toward draft/clustering outputs and no longer emits the `actionCards` array that the runtime tests still expect.

The queue/store module is not dead code by itself:

- tests import and use it directly;
- it has storage and update helpers for decision/apply/notification/contact-evidence flows;
- but no current HTTP route in `src/server.ts` or `src/merlin/routes/*` exposes those flows under `/api/mealscout/intake/action-cards*`.

## Proposed Smallest Repair Lane

Repair lane name:

`fix/merlin-mealscout-action-card-contract-drift`

Smallest likely scope:

1. Reconcile whether MealScout intake action-card contracts should be restored under `/api/mealscout/intake/action-cards*` and `/api/mealscout/intake/notifications/:id/open`, or whether tests should be rewritten to consume a new Merlin-native route surface.
2. Separately decide whether `POST /api/mealscout/intake/preview` must reintroduce an `actionCards` field or whether a compatibility adapter should map current draft outputs into that shape.
3. Keep preview contract repair separate from action-card route mounting if possible, since the source evidence shows they are distinct drifts.

## Explicit Non-Changes

- Runtime code changed: no
- Test files changed: no
- Schemas or tables changed: no
- Fixtures changed: no
- MealScout apply-flow behavior changed: no
- Screenshot extraction changed: no
- Export approval changed: no
- Push performed: no
- Deploy performed: no

## Final Git State

- Branch after inspection: `main`
- HEAD after inspection: `ca4d6f8ed8c7fbc1fdf434a1af41ddf1488421a6`
- Git status after inspection: report artifact added only
