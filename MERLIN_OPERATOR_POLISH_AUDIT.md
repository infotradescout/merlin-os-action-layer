# Merlin Operator Polish Audit

## Decision

This audit supersedes any MealScout-specific polish framing for the current cleanup pass. The active target is Merlin OR / Merlin OS Action Layer, especially the Merlin operator surfaces and `/api/merlin/*` runtime groups.

No new product features are proposed here. This is documentation and contract-test cleanup only.

The current repo has a validation blocker outside this audit: TypeScript/build imports and types are failing in MealScout affiliate/profile-seeding paths. Resolve that before making broad UI changes, because Merlin polish should be validated against a compiling repo.

## Active Merlin Surface

- `/` and `/index.html`: `public/index.html`, titled `Merlin Daily`.
- `/api/merlin/operator-console`: read-only Merlin operator console payload from `src/merlin/operatorConsoleRuntime.ts`.
- `/api/merlin/intake`: Merlin intake item creation, listing, status, history, and action-card generation.
- `/api/merlin/action-cards`: Merlin action-card creation, listing, decisions, history, and approval-state link.
- `/api/merlin/approvals`: approval records and approval-state handling.
- `/api/merlin/execution-plans`: execution-plan creation, listing, status, history, and connector checks.
- `/api/merlin/connector-adapters`: connector adapter checks.
- `/api/merlin/dry-run-executions`: dry-run execution records and status/history.
- `/api/merlin/live-execution-gates`: live execution gate records and history.
- `/api/merlin/workspaces`: workspaces, members, and brand permissions.
- `/api/merlin/role-policy-checks`: role policy check records.
- `/api/merlin/entities` and `/api/merlin/source-observations`: entity memory and source observation runtime.
- `/api/merlin/outcomes` and `/api/merlin/kpi-rollup`: Merlin outcome records and KPI rollups.
- `/api/merlin/search`: gated Merlin search over the intake/search foundation.

## What Merlin Should Communicate

Merlin should read as a controlled operator console:

- What needs operator attention?
- Which approvals, action cards, execution plans, or live gates are blocked?
- Which entity or source evidence explains the item?
- Which outcome was recorded?
- Is this read-only, dry-run, approval-required, or live-gated?
- Which brand lane is involved: Merlin, MealScout, TradeScout, or Trader's Corner?

## What Merlin Is Not

- Not MealScout affiliate attribution UI.
- Not MealScout payout approval.
- Not a customer-facing MealScout, TradeScout, or Trader's Corner product page.
- Not a live connector execution shortcut.
- Not a Drive cleanup/delete/archive shortcut.
- Not a profile seeding, verification email, affiliate ledger, publish, payout, or cleanup behavior change.

## UI And Copy Issues Found

- `public/index.html` still frames the page as `Merlin Daily` and `v1.0 command center`; the runtime now contains a broader operator-console/action-layer surface.
- The page mixes daily overview, approvals, outcomes, replay/audit, LISA browser, and Drive review entry without a single operator hierarchy.
- The detail panel exposes `Policy` and `Linked Outcome` as raw JSON via `JSON.stringify`, which reads like an engineering debug view.
- `Replay / Audit` is accurate for handoff and tests, but can feel internal when used as a primary operator label without helper framing.
- `LISA Browser` is important, but should be consistently described as search/evidence context when exposed to operators.
- Drive actions appear near read/audit details on the Merlin Daily page; their current guardrails must stay intact and any future copy pass should visually separate inspect/read actions from mutation/routing actions.
- Labels such as `entity_id`, raw source refs, policy payloads, and outcome payloads are useful diagnostics but should live under technical details, not the primary workflow.
- Brand boundaries are easy to blur because Merlin links to Drive and knows about MealScout/TradeScout runtime paths.

## Preferred Merlin Operator Language

Use this language in future copy-only polish after the repo compiles:

- `Merlin Operator Console`
- `Needs Attention`
- `Approvals`
- `Action Cards`
- `Execution Plans`
- `Dry Runs`
- `Live Gates`
- `Entity Evidence`
- `Source Observations`
- `Outcome History`
- `Audit Trail`
- `Technical Details`
- `Read-only`
- `Approval required`
- `Live gated`
- `Blocked`

Avoid making these the primary operator labels:

- `mutationAllowed`
- `policy_result`
- `source_refs`
- `lineage metadata`
- `raw replay payload`
- `connector adapter internals`
- `durable propagation`

Those terms can remain in code, route contracts, tests, and technical details where they are valuable.

## Behavior Preservation Boundary

- No new routes.
- No new APIs.
- No new data fields.
- No new product flows.
- No new connector behavior.
- No permission changes.
- No Drive mutation, publish, cleanup/delete/archive, payout, profile seeding, verification email, affiliate ledger, or live execution behavior changes.
- No generated/sample production data.
- MealScout, TradeScout, and Trader's Corner remain explicit brand lanes and must not be collapsed into a generic customer workflow.

## Validation Commands

Run for this audit:

```bash
node scripts/merlin-operator-polish-contract.test.mjs
npm run check
npm run build
```

Run focused Merlin tests after the existing compile blocker is resolved:

```bash
npx tsx --test tests/merlin-operator-console-runtime.test.ts tests/merlin-action-card-runtime.test.ts tests/merlin-approval-runtime.test.ts tests/merlin-execution-plan-runtime.test.ts tests/merlin-dry-run-executor-runtime.test.ts tests/merlin-live-execution-gate-runtime.test.ts
```

## Cleanup Tickets

1. Cleanup: fix the existing MealScout affiliate/profile-seeding compile blocker so Merlin polish can be validated with `npm run check` and `npm run build`.
2. Cleanup: rename visible Merlin page framing from `Merlin Daily`-only language to an operator-console hierarchy where the daily view is one section.
3. Cleanup: group raw policy/outcome JSON behind a `Technical Details` section without changing payloads or endpoints.
4. Cleanup: standardize Merlin statuses across action cards, approvals, execution plans, dry runs, live gates, and outcomes.
5. Cleanup: add a route inventory contract for `/api/merlin/*` route groups wired in `src/server.ts`.
6. Cleanup: add a UI copy contract for `public/index.html` once labels are intentionally updated.
7. Cleanup: document Merlin brand-lane behavior for Merlin, MealScout, TradeScout, and Trader's Corner in a short operator glossary.
8. Cleanup: visually separate Drive inspect actions from Drive route/archive actions on the Merlin page without changing Drive behavior.
9. Cleanup: inventory which Merlin runtime models are SQLite-backed versus process-local before changing storage docs.
10. Cleanup: add a deploy/runtime note for Merlin feature flags and live-execution gates once hosting target is known.
