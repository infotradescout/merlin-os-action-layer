# Merlin OR Handoff Spine

## App identity

App name: Merlin OR / Merlin OS Action Layer.

Repository: `infotradescout/merlin-os-action-layer`.

Package name: `merlin-or`.

Runtime: Node.js TypeScript HTTP service using `tsx` for development and `tsc` for build output.

Main server entry: `src/server.ts`.

Default service name and port come from `src/constants.ts`: `merlin-or` on port `3030`.

Primary persistent runtime store: SQLite through `better-sqlite3`, defaulting to `./data/merlin-or.sqlite` unless `MERLIN_DB_PATH` is set.

## What this app is

Merlin OR is a controlled action layer for Merlin OS. It turns trusted business intent and real evidence into safe, auditable actions while preserving brand separation, source-of-truth discipline, permission levels, policy gates, approvals, dry-run execution plans, and outcome tracking.

It coordinates around these active lanes:

- Merlin core: intake, action cards, approvals, dry-runs, operator console, outcomes, workspace, entity memory, and search.
- TradeScout: contractors and homeowners.
- MealScout: food trucks, event hosts, vendors, restaurants, screenshot intake, review, publish planning, and affiliate attribution.
- Trader's Corner: trading and sports only, inactive unless explicitly selected.
- LISA: signal ingestion, truth/newness scoring, lane routing, timeline, and daily context.

## What this app is not

- It is not a general chatbot prompt collection.
- It is not a fake CRM.
- It is not the primary product UI for MealScout, TradeScout, or Trader's Corner customers.
- It is not a cross-brand funnel.
- It is not a payment shortcut, payout engine, or banking ledger.
- It is not a live external mutation engine by default.
- It is not a Google Drive cleanup bot that should delete, archive, trash, publish, or route files without explicit existing guardrails.
- It must not create fake users, fake events, fake payment records, guessed email recipients, hidden fees, or cross-brand execution.
- It must not mark seeded screenshot profiles as email verified, insurance verified, claimed, or owner verified unless the product's normal verification flow proves that state.
- It must not use an affiliate folder email as a business/profile verification recipient unless that same email is extracted from the screenshot evidence itself.
- It is not a place to add new product features during production cleanup / handoff mode.

## Core user and operator flows

1. Merlin intake flow: real input or evidence enters Merlin, becomes a durable intake item, resolves source/entity context, and may generate action cards.
2. Action-card flow: action candidates persist with brand, KPI, intent, source-of-truth, required real data, tool, action, permission level, fail-safes, output location, status, and policy result.
3. Approval flow: approval-required or high-risk action cards get approval records and decision history before execution planning.
4. Dry-run execution flow: approved or eligible action cards become dry-run execution plans, pass connector adapter contract checks, and create dry-run execution records without external mutation.
5. Live execution gate flow: dry-run executions can be evaluated for live eligibility, but live execution remains globally disabled by default.
6. Outcome flow: outcomes attach back to action cards, intake, entities, and KPI rollups.
7. Operator console flow: one read-only summary view shows blocked intake, conflicts, approvals, execution plans, adapter checks, dry-runs, live gates, outcomes, and KPI movement.
8. Drive safety and review flow: Drive files are imported/synced, represented in a manifest, surfaced for operator review, and routed only through existing auth and mutation guardrails.
9. MealScout review queue flow: operators review extracted screenshot/intake evidence, make metadata/correction/attachment decisions, inspect batches, and use existing guarded publish-plan paths.
10. Screenshot profile seed flow: existing screenshot evidence can seed TradeScout or MealScout profiles separately, preserve affiliate attribution, write ledger rows, and trigger only normal product verification email hooks for extracted business/profile emails.

## Entry routes and pages

This repo is not API/service-only. It includes static client/router entry points under `public/`, served directly by `src/server.ts`.

Important pages:

- `/` and `/index.html`: main static operator page from `public/index.html`.
- `/admin/drive-review-queue`: Drive review queue page from `public/drive-review-queue.html`.
- `/admin/drive-review-queue-client.js`: Drive review queue client module.
- `/admin/mealscout-review-queue`: MealScout review queue page from `public/mealscout-review-queue.html`.
- `/admin/mealscout-review-queue-client.js`: MealScout review queue client module.

Important startup commands:

- `npm run dev` starts `tsx watch src/server.ts`.
- `npm run dev:or` loads `.env` then starts `tsx watch src/server.ts`.
- `npm run start` runs `node dist/server.js` after build.

## Server route and API groups

Main route wiring is split between direct `src/server.ts` conditionals and modular handlers in `src/merlin/routes/*`.

- Health/daily/search: `GET /api/health`, `GET /api/daily`, `GET /api/search`.
- LISA/events/replay: `/api/lisa/*`, `/api/events/tradescout`, `/api/events/mealscout`, `/api/events/crawlability`, `/api/changes/recent`, `/api/replay/recent`.
- Legacy approvals/demo: `/api/approvals/*`, `/api/demo/reset`, `/api/demo/seed-tradescout-loop`.
- Drive import/sync/safety/review: `/api/drive/import-file`, `/api/drive/sync`, `/api/drive/auth-health`, `/api/drive/reconciliation`, `/api/drive/review-queue*`, `/api/drive/status`, `/api/drive/manifest`, `/api/drive/needs-review`, `/api/drive/review/:drive_file_id/route`, `/api/drive/review/:drive_file_id/mark-reviewed`, `/api/drive/review/:drive_file_id/attach-entity`, `/api/drive/review/:drive_file_id/entity-suggestions`.
- MealScout intake/review/publish: `/api/mealscout/intake/*`, `/api/mealscout/profile-import/batches`, `/api/mealscout/review-decisions*`, `/api/mealscout/review-corrections`, `/api/mealscout/attachment-decisions`, `/api/mealscout/batches/:batch_id/*`, `/api/mealscout/drafts/*`.
- Merlin profile seeding: `/api/merlin/profile-seeding/process-existing-screenshots`, `/api/merlin/profile-seeding/tradescout-profiles`, `/api/merlin/profile-seeding/verification-emails`.
- Merlin modular routes: `/api/merlin/operator-console*`, `/api/merlin/intake*`, `/api/merlin/action-cards*`, `/api/merlin/entities*`, `/api/merlin/source-observations`, `/api/merlin/outcomes*`, `/api/merlin/kpi-rollup`, `/api/merlin/approvals*`, `/api/merlin/execution-plans*`, `/api/merlin/connector-adapters*`, `/api/merlin/dry-run-executions*`, `/api/merlin/live-execution-gates*`, `/api/merlin/workspaces*`, `/api/merlin/role-policy-checks`, `/api/merlin/search`.

Key module groups:

- Merlin core: `src/merlin/*Runtime.ts` and `src/merlin/routes/*`.
- LISA and recommendations: `src/lisa.ts`, `src/recommendations.ts`, `src/outcomes.ts`, `src/replay.ts`, `src/search.ts`.
- Policy and safety: `src/policy.ts`, `src/approvalQueue.ts`, `src/driveSafety.ts`, `src/operatorIdentity.ts`.
- Google Drive and file intake: `src/driveAuth.ts`, `src/driveClient.ts`, `src/driveSync.ts`, `src/driveScheduler.ts`, `src/driveManifest.ts`, `src/driveReviewQueue.ts`, `src/driveIngest.ts`, `src/fileExtraction.ts`.
- MealScout screenshot/intake/profile seed area: `src/mealscoutDriveIntake.ts`, `src/mealscoutScreenshotExtraction.ts`, `src/mealscoutEvidenceClustering.ts`, `src/mealscoutProfileImport.ts`, `src/mealscoutPublishPlan.ts`, `src/mealscoutPublishExecution.ts`, `src/mealscoutAffiliateFolderAttribution.ts`, `src/mealscoutAffiliateTrackingLedger.ts`, `src/mealscoutAffiliateAttributionKpiRollup.ts`, `src/mealscoutCandidateImport.ts`, `src/mealscoutOcrAdapter.ts`.
- TradeScout seeded profile area: TradeScout seeded contractor-business profiles currently live inside `src/merlin/profileSeedRuntime.ts` rather than a separate product adapter file.

## Main data and storage model

Primary storage is SQLite via `better-sqlite3`, with runtime modules creating tables in the configured DB path.

Known table groups include:

- LISA state: `events`, `timeline_entries`, `entity_state`.
- Drive manifest: `drive_manifest_entries`.
- Recommendations: `recommendations`.
- Legacy outcomes: `outcome_recommendations`, `outcome_records`.
- Replay: `replay_events`.
- Merlin action cards: `merlin_action_cards`, `merlin_action_card_history`.
- Merlin intake: `merlin_intake_items`, `merlin_intake_item_history`, `merlin_intake_action_card_links`.
- Merlin entities: `merlin_entities`, `merlin_entity_identifiers`, `merlin_entity_aliases`, `merlin_entity_conflicts`, `merlin_source_observations`, `merlin_entity_history`.
- Merlin outcomes: `merlin_outcomes`, `merlin_outcome_history`.
- Merlin approvals: `merlin_approvals`, `merlin_approval_history`.
- Merlin execution plans: `merlin_execution_plans`, `merlin_execution_plan_history`.
- Merlin connector adapters: `merlin_connector_adapters`, `merlin_connector_adapter_checks`.
- Merlin dry-run executions: `merlin_dry_run_executions`, `merlin_dry_run_execution_history`.
- Merlin live execution gates: `merlin_live_execution_gates`, `merlin_live_execution_gate_history`.
- Merlin workspace and role policy tables from `src/merlin/workspaceRuntime.ts`.
- Merlin intake action-card queue: `merlin_intake_action_cards`.

Operational flat file:

- Affiliate tracking ledger CSV, default expected path `./data/affiliate-tracking-ledger.csv` unless overridden by `MEALSCOUT_AFFILIATE_TRACKING_LEDGER_PATH`.

Important process-local state still exists in some modules, including seeded profile collections and test-oriented runtime state. Treat this as a production-readiness risk until explicitly hardened.

## External integrations

- Google Drive through `googleapis` for OAuth-backed Drive inspection, folder discovery, reconciliation, intake sync, manifest, routing, duplicate removal guardrails, and review queue support.
- Google OAuth env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN`, optional `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`.
- Merlin Drive env: `MERLIN_DRIVE_MODE`, `MERLIN_DRIVE_SYNC_ENABLED`, `MERLIN_DRIVE_ROOT_MODE`, `MERLIN_DRIVE_ROOT_FOLDER_NAME`, `MERLIN_DRIVE_ROOT_FOLDER_ID`, `MERLIN_DRIVE_SYNC_MODE`, `MERLIN_DRIVE_SYNC_INTERVAL_MINUTES`, `MERLIN_DRIVE_BOOTSTRAP_ENABLED`, `MERLIN_DRIVE_CREATE_MISSING_FOLDERS`.
- Product verification email webhook through `MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_URL` and optional `MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_TOKEN`.
- OCR/image extraction: local OCR adapter exists for MealScout screenshot processing; `TESSERACT_PATH` can point to a local Tesseract binary.
- Operator identity: trusted request headers and `MERLIN_OPERATOR_ID`; role may use `MERLIN_OPERATOR_ROLE`.
- MealScout affiliate mapping and ledger: `MEALSCOUT_AFFILIATE_EMAIL_MAP`, `MEALSCOUT_AFFILIATE_TRACKING_LEDGER_PATH`.
- Dangerous duplicate trash mode: `MEALSCOUT_ENABLE_DANGEROUS_TRASH_MODE=true` is required before trash mode is allowed.
- Google/Gmail/Calendar/Stripe/Canva are documented target connector lanes, but live connector execution remains gated and should not be assumed enabled from this repo alone.

## Deployment and runtime assumptions

- Node version must satisfy `>=20 <25`.
- TypeScript source is under `src`; build output goes to `dist`.
- `npm run build` compiles with `tsc -p tsconfig.json`.
- `npm run check` runs `tsc -p tsconfig.json --noEmit`.
- `npm run test` runs `tsx --test --test-concurrency=1 tests/*.test.ts`.
- Drive/OAuth workflows should use `npm run dev:or` so `.env` is loaded.
- `PORT` overrides the default `3030`.
- `MERLIN_RUNTIME=test` suppresses server auto-start in tests and unlocks test reset helpers in selected modules.
- No root `render.yaml`, `Dockerfile`, or equivalent deployment config was found during handoff inspection.
- There is no explicit migration runner. Existing modules use `CREATE TABLE IF NOT EXISTS`, but explicit backup and smoke checks are still required before production use.

Deploy order if storage changes are ever required:

1. Document the table, column, or index change and rollback expectation.
2. Add contract tests around existing behavior first.
3. Add a migration or runtime compatibility path.
4. Deploy code that can read old and new shapes.
5. Backfill only after read compatibility is live.
6. Remove compatibility only in a later cleanup after validation.

## Known danger zones

1. `src/server.ts` is a large route aggregator with many imports and route branches. It is the first file a developer will need to map before touching behavior.
2. MealScout-specific logic and Merlin core logic are close together. Cleanup must clarify boundaries without rewriting features.
3. Profile seeding, verification email, affiliate ledger, Drive mutation, publish, cleanup/delete/archive, payout, and live connector execution behavior are production-sensitive. In handoff cleanup mode, document current behavior only.
4. Drive route/sync/mutation paths must keep auth-health and managed-folder guardrails.
5. MealScout duplicate removal has an explicit dangerous trash env gate; do not bypass it.
6. Product verification email can call a webhook when configured. Misconfiguration can produce failed sends; it must not fake success.
7. Verification email recipients must come from extracted business/profile evidence according to the current path, not affiliate folders or guessed data.
8. Affiliate attribution is not payout. Do not turn attribution/KPI records into payment behavior.
9. Some seeded profile state appears in memory inside runtime modules. Treat as non-final production persistence until documented or migrated.
10. Trader's Corner must remain separate from MealScout and TradeScout.
11. `.env` may contain real credentials. Do not copy secrets into docs, tests, reports, or commits.
12. The current worktree may contain local reports, smoke artifacts, and untracked generated outputs. Do not treat them as product fixtures.
13. Tests have reported Windows temp-directory cleanup `EPERM` failures in Drive/demo/entity tests. Do not treat those as product logic failures without reproducing.

## Existing workflow docs inspection

- `README.md`: exists.
- `WORKFLOW.md`: missing.
- `CLEANUP_MAP.md`: missing.
- `CODEBASE_PATTERNS_OVERVIEW.md`: missing.
- Repo doctor script: not found in `package.json` or `scripts/`.
- Deployment config: not found in common repo-root deployment files during this inspection.
- Client/router entry: exists. Static pages are in `public/`, and server route wiring is in `src/server.ts` plus `src/merlin/routes/*`.

## Validation commands

Fastest safe validation:

```bash
node scripts/merlin-or-handoff-spine.contract.test.mjs
npm run check
npm run build
```

Focused Merlin/profile seed validation examples:

```bash
npx tsx --test tests/merlin-action-card-runtime.test.ts
npx tsx --test tests/merlin-intake-runtime.test.ts
npx tsx --test tests/merlin-entity-memory-runtime.test.ts
npx tsx --test tests/merlin-outcome-runtime.test.ts
npx tsx --test tests/merlin-operator-console-runtime.test.ts
npx tsx --test tests/merlin-approval-runtime.test.ts
npx tsx --test tests/merlin-execution-plan-runtime.test.ts
npx tsx --test tests/merlin-connector-adapter-runtime.test.ts
npx tsx --test tests/merlin-dry-run-executor-runtime.test.ts
npx tsx --test tests/merlin-live-execution-gate-runtime.test.ts
npx tsx --test tests/merlin-profile-seeding-slice13.test.ts
npx tsx --test tests/product-verification-email.test.ts
```

Full test command:

```bash
npm run test
```

Known caution: full tests may hit pre-existing Windows temp cleanup `EPERM` issues in non-Slice logic.

Drive/OAuth readiness commands:

```bash
npm run dev:or
curl -s http://localhost:3030/api/drive/auth-health
curl -s http://localhost:3030/api/drive/reconciliation
```

## Developer onboarding checklist

1. Install Node `>=20 <25`.
2. Run `npm install`.
3. Read `README.md`.
4. Read this handoff spine.
5. Inspect `package.json` scripts.
6. Inspect `src/server.ts` route ordering before changing any API behavior.
7. Inspect `src/policy.ts`, `docs/permissions.md`, and `docs/brand-lanes.md` before changing action/approval behavior.
8. Inspect `src/drive*` before touching Drive auth, manifest, sync, routing, or safety behavior.
9. Inspect `src/mealscout*` before touching MealScout intake, review, affiliate, publish, or OCR behavior.
10. Run `node scripts/merlin-or-handoff-spine.contract.test.mjs`.
11. Run `npm run check`.
12. Run `npm run build`.
13. Run focused tests for the area being touched before full `npm run test`.
14. For Drive work, configure `.env`, use `npm run dev:or`, and validate `/api/drive/auth-health` before mutation tests.
15. For verification email work, configure `MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_URL` and optional token only in the correct environment.
16. Never infer production readiness from smoke tests alone; inspect the relevant ledger/audit output.

## Next cleanup tickets

1. Add `WORKFLOW.md` defining cleanup mode, feature freeze rules, validation ladder, commit discipline, and no-touch zones.
2. Add `CLEANUP_MAP.md` with ordered cleanup tickets and a single current NEXT marker.
3. Add `CODEBASE_PATTERNS_OVERVIEW.md` to document module patterns, runtime table creation pattern, route-handler pattern, test pattern, and safe mutation pattern.
4. Create a route inventory for `src/server.ts` and `src/merlin/routes/*` without changing behavior.
5. Document all environment variables in one `.env.example` or `ENVIRONMENT.md` without adding secrets.
6. Create a schema/table inventory doc from runtime modules and mark which storage is durable SQLite versus in-memory.
7. Document MealScout-specific versus Merlin-core boundary files to reduce accidental cross-brand edits.
8. Add a verification-email transport runbook covering unconfigured, configured, failed, and provider-message-ID cases.
9. Add a Windows test cleanup note or guard for known temp-directory `EPERM` failures.
10. Add a production deploy checklist that explicitly covers DB backup, `npm run check`, `npm run build`, focused tests, Drive health, verification webhook health, and post-deploy smoke.

## No new product features proposed

This handoff spine intentionally proposes cleanup, documentation, validation, and safety-contract work only. It does not propose new user-facing features, new product surfaces, live connector execution, new monetization, payout logic, profile verification shortcuts, or cross-brand behavior changes.
