# Product Polish Audit

## Audit Decision

Production polish should pause before UI edits because the current repo does not pass TypeScript validation or full tests. The observed blocker is existing runtime/type drift around MealScout affiliate attribution and profile-seeding types, including `src/server.ts` importing `getMealScoutAffiliateAttributionActionCards` from `src/mealscoutAffiliateAttributionKpiRollup.ts` when that export is not currently present.

This audit documents the active surfaces and polish issues using existing repo facts only. No new product features are proposed by this audit.

No payout, live execution, or verification shortcut is proposed.

## Active User And Operator Surfaces

- `/` / `/index.html`: Merlin Daily command center from `public/index.html`.
- `/admin/drive-review-queue`: internal Drive Review Queue from `public/drive-review-queue.html`.
- `/admin/mealscout-review-queue`: internal MealScout OCR Review Queue from `public/mealscout-review-queue.html`.
- `/admin/drive-review-queue-client.js`: browser client for Drive review queue API calls.
- `/admin/mealscout-review-queue-client.js`: browser client for MealScout intake, review, affiliate, publish-plan, batch, and action-card API calls.

## What Each Surface Is For

- Merlin Daily command center: daily operational overview, pending approvals, recent outcomes, replay/audit, LISA browser, and Drive needs-review list.
- Drive Review Queue: internal operational inbox for Drive auth health, reconciliation summary, metadata-only decisions, queue item detail, decision history, and audit export.
- MealScout OCR Review Queue: internal operator station for OCR draft profile review, duplicate/merge assist, unattached media, publish-plan preview, Drive batch intake, batch history, candidate import assist, folder context assist, affiliate dashboard, and Merlin intake action-card review.
- Drive review queue client: fetches Drive review queue state, detail, history, audit, export, auth health, reconciliation, and posts metadata-only queue decisions.
- MealScout review queue client: fetches and posts existing MealScout review, correction, attachment, batch, candidate import, affiliate attribution, action-card, and publish-plan endpoints.

## Raw Or Debug-Looking Surfaces

- Merlin Daily detail panel displays policy and outcome data with `JSON.stringify`, which can look like an engineering console rather than a guided operator workflow.
- Drive Review Queue intentionally exposes operational concepts such as auth health, reconciliation, decision history, audit trail, and `mutationAllowed:false`; it should remain clearly labeled as internal.
- MealScout OCR Review Queue is very dense and mixes OCR drafts, Drive batches, affiliate dashboard, publish-plan preview, action cards, and manual corrections on one page.
- MealScout UI test expectations include raw safety terms such as `mutationAllowed`; useful for safety, but visually raw unless grouped under operational details.
- Latest smoke/report artifacts at repo root are numerous and can make the repo feel like a scratchpad rather than a product-managed app.

## Inconsistent Copy And Labels

- The same work loop is described with mixed terms: `action card`, `draft`, `profile`, `seed`, `apply`, `publish`, `candidate import`, and `batch`.
- Drive surface uses “Review Queue,” “Operational inbox,” “Decision Audit Trail,” and “Queue Item Detail”; these are reasonable but should use one hierarchy.
- MealScout surface uses “OCR Review Queue,” “Draft Profiles,” “Publish Plan Preview,” “Batch Intake,” “Candidate Import Assist,” “Folder Context Assist,” “Affiliate Dashboard,” and “Merlin Intake Action Card Review” in one screen without a single task-first progression.
- “Publish (Disabled)” and “Preview only - no records will be published.” are safe, but should be standardized with other “read-only/safe mode” copy.
- Affiliate attribution copy must consistently say credit/lineage only, not payout.
- Seeded/profile verification language must consistently preserve unverified/unclaimed meaning where shown.

## Inconsistent Buttons And Actions

- Merlin Daily includes Drive route buttons such as `Route Processed`, `Attach to Entity`, and `Archive Source` near read/audit sections; action risk is not visually grouped as strongly as the action semantics require.
- Drive Review Queue decision buttons are clearer: `Acknowledge`, `Needs manual review`, `Mark externally resolved`, `Mark false positive`, and `Defer`.
- MealScout has many adjacent action buttons: `Run batch intake`, `Sync + Process New Batches`, `Admin Fast Lane: Sync + Process + Auto-Apply Safe Cards`, `Bulk Approve + Apply Selected`, `Approve for Apply`, `Dry Run`, `Publish (Disabled)`, `Mark as same truck`, `Keep separate`, and `Needs review`.
- Dangerous or high-impact labels should share a consistent warning pattern before any visual polish touches behavior.
- “Apply,” “publish,” “auto-apply,” and “fast lane” need consistent safety qualifiers because they sound like live production mutations even when existing guards constrain them.

## Inconsistent Cards, Tables, And Layouts

- Merlin Daily uses dashboard cards and a detail panel, then raw JSON blocks in the same context.
- Drive Review Queue is more focused but still mixes status strips, summary cards, list/detail workflow, audit list, and export controls.
- MealScout Review Queue is the most visibly AI-assembled surface: many operational modules are stacked into one long page with mixed cards, lists, filters, badges, and command groups.
- Status badges exist but are not clearly standardized across Merlin, Drive, and MealScout surfaces.
- Tables/lists should use consistent density, metadata order, and action grouping before any new feature work resumes.

## Mobile Layout Risks

- MealScout review queue has the highest mobile risk because it is long, dense, and button-heavy.
- Batch controls, action-card filters, search/filter chips, and selected-card bulk actions risk wrapping into hard-to-scan stacks.
- Merlin Daily detail actions and Drive route buttons risk crowding on smaller screens.
- Raw JSON/preformatted detail blocks can overflow or dominate mobile viewports.
- Long button labels such as `Admin Fast Lane: Sync + Process + Auto-Apply Safe Cards` can wrap awkwardly and make action hierarchy unclear.

## Admin And Operator Confusion Risks

- Internal surfaces are active and powerful-looking; every page needs persistent internal/operational framing.
- Operators may confuse affiliate attribution with payout unless every affiliate surface says credit/lineage only.
- Operators may confuse publish-plan preview with live publish if disabled/preview copy is not consistently placed near actions.
- Operators may confuse seeded profiles with verified or claimed profiles unless unverified/unclaimed language is visible where profile state is shown.
- Operators may not know which page owns a task because MealScout review queue mixes review, batch intake, candidate import, folder context, affiliate, and action-card workflows.
- Merlin Daily includes Drive route/archive actions near read-only/audit content, increasing the need for clear danger grouping.

## Brand Separation Risks

- Merlin should remain the orchestration and operator-console layer.
- MealScout should remain food truck/vendor/event-host workflow space.
- TradeScout should remain contractor/homeowner workflow space.
- Trader's Corner should remain separate and inactive unless explicitly selected.
- The current UI copy should avoid implying that MealScout affiliate attribution, TradeScout profile seeding, or Trader's Corner trading/sports concepts share one customer-facing workflow.
- The app should avoid generic “profile” copy when a surface means MealScout food truck profile, TradeScout contractor profile, or Merlin entity memory.

## Top 10 Polish Fixes Ranked By User Impact

1. Polish fix: resolve the existing TypeScript/import blocker before UI polish so the app can compile and tests can run.
2. Polish fix: create a UI copy glossary for `draft`, `profile`, `seed`, `apply`, `publish`, `action card`, `batch`, and `candidate import`.
3. Polish fix: add persistent internal/operational labels to active admin pages where the page already represents internal workflows.
4. Polish fix: standardize safety copy for read-only, preview-only, disabled publish, safe mode, and mutation-blocked states.
5. Polish fix: standardize affiliate attribution language as credit/lineage only and never payout.
6. Polish fix: standardize unverified/unclaimed profile language wherever seeded profile state is shown.
7. Polish fix: group high-impact buttons separately from inspect/filter buttons without changing endpoints or permissions.
8. Polish fix: move raw JSON-looking detail blocks behind existing-style details/operational sections where safe to do so.
9. Polish fix: define shared badge/status labels for success, warning, danger, blocked, preview-only, read-only, and needs-review states.
10. Polish fix: perform a mobile spacing pass on MealScout review queue controls, filters, badges, and long action labels.

## Behavior Preservation Boundary

- No new product features.
- No new product surfaces.
- No new APIs.
- No new data models.
- No business logic changes.
- No role permission changes.
- No verification flag changes.
- No payout behavior changes.
- No publish/delete/archive/cleanup behavior changes.
- No live connector execution changes.
- No fake data or sample/demo profiles.
- No cross-brand behavior changes.

## Validation Plan

Required validation for this audit:

```bash
node scripts/product-polish-contract.test.mjs
npm run check
npm run build
```

Focused UI/browser tests should run only after UI files change. This audit does not change UI files because the repo currently has a compile/import blocker.
