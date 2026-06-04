# Merlin OR Handoff Spine

## App identity

App name: Merlin OR / Merlin OS Action Layer.

Repository: `infotradescout/merlin-os-action-layer`.

Package name: `merlin-or`.

Runtime: Node.js TypeScript service using `tsx` for development and `tsc` for build output.

Main server entry: `src/server.ts`.

Primary persistent runtime store: SQLite through `better-sqlite3`, defaulting to `./data/merlin-or.sqlite` unless `MERLIN_DB_PATH` is set.

## What this app is

Merlin OR is a controlled action layer for Merlin OS. It turns trusted business intent and real evidence into safe, auditable actions while preserving brand separation, source-of-truth discipline, permission levels, policy gates, approvals, dry-run execution plans, and outcome tracking.

It coordinates around these active lanes:

- TradeScout: contractors and homeowners.
- MealScout: food trucks, event hosts, vendors, restaurants, and public food/event customers.
- Trader's Corner: trading and sports only, inactive unless explicitly selected.
- LISA: signal ingestion, truth/newness scoring, and lane routing.
- Merlin core: intake, action cards, approvals, dry-runs, operator console, outcomes, and search.

## What this app is not

- It is not a general chatbot prompt collection.
- It is not a fake CRM.
- It is not a replacement for product-specific application code.
- It is not a cross-brand funnel.
- It is not a payment shortcut.
- It is not a live external mutation engine by default.
- It must not create fake users, fake events, fake payment records, guessed email recipients, hidden fees, or cross-brand execution.
- It must not mark seeded screenshot profiles as email verified, insurance verified, claimed, or owner verified unless the product's normal verification flow proves that state.
- It must not use an affiliate folder email as a business/profile verification recipient unless that same email is extracted from the screenshot evidence itself.

## Core user and operator flows

1. Merlin intake flow: real input or evidence enters Merlin, becomes a durable intake item, resolves source/entity context, and may generate action cards.
2. Action-card flow: action candidates persist with brand, KPI, intent, source-of-truth, required real data, tool, action, permission level, fail-safes, output location, status, and policy result.
3. Approval flow: approval-required or high-risk action cards get approval records and decision history before execution planning.
4. Dry-run execution flow: approved/eligible action cards become dry-run execution plans, pass connector adapter contract checks, and create dry-run execution records without external mutation.
5. Live execution gate flow: dry-run executions can be evaluated for live eligibility, but live execution remains globally disabled by default.
6. Outcome flow: outcomes attach back to action cards/intake/entities and feed KPI rollups.
7. Operator console flow: one read-only summary view shows blocked intake, conflicts, approvals, execution plans, adapter checks, dry-runs, live gates, outcomes, and KPI movement.
8. Screenshot profile seed flow: existing screenshot evidence can seed TradeScout or MealScout profiles separately, preserve affiliate attribution, write ledger rows, and trigger only normal product verification email hooks for extracted business/profile emails.
9. Drive/OAuth safety flow: Drive health and reconciliation guard Drive mutation paths and expose read-only drift/review state.

## Entry routes and pages

This repo is primarily an HTTP API/service. No main client/router entry was found in the inspected root files. Browser tests may exist, but the main runtime entry is `src/server.ts`.

Important startup commands:

- `npm run dev` starts `tsx watch src/server.ts`.
- `npm run dev:or` loads `.env` then starts `tsx watch src/server.ts`.
- `npm run start` runs `node dist/server.js` after build.

Important public/runtime route groups currently wired through `src/server.ts` include:

- `/api/health`
- `/api/search`
- `/api/demo/reset`
- `/api/drive/auth-health`
- `/api/drive/reconciliation`
- `/api/drive/review-queue...`
- `/api/merlin/action-cards...`
- `/api/merlin/intake...`
- `/api/merlin/entities...`
- `/api/merlin/outcomes...`
- `/api/merlin/operator-console...`
- `/api/merlin/approvals...`
- `/api/merlin/execution-plans...`
- `/api/merlin/connector-adapters...`
- `/api/merlin/dry-run-executions...`
- `/api/merlin/live-execution-gates...`
- `/api/merlin/workspaces...`
- `/api/merlin/profile-seeding/process-existing-screenshots`
- MealScout intake, review, publish-plan, duplicate/quarantine, affiliate attribution, OCR, and candidate import route groups.

## Server route and API groups

### Merlin core

- `src/merlin/actionCardRuntime.ts`
- `src/merlin/routes/merlinActionCardRoutes.ts`
- `src/merlin/intakeRuntime.ts`
- `src/merlin/routes/merlinIntakeRoutes.ts`
- `src/merlin/entityMemoryRuntime.ts`
- `src/merlin/routes/merlinEntityMemoryRoutes.ts`
- `src/merlin/outcomeRuntime.ts`
- `src/merlin/routes/merlinOutcomeRoutes.ts`
- `src/merlin/operatorConsoleRuntime.ts`
- `src/merlin/routes/merlinOperatorConsoleRoutes.ts`
- `src/merlin/approvalRuntime.ts`
- `src/merlin/routes/merlinApprovalRoutes.ts`
- `src/merlin/executionPlanRuntime.ts`
- `src/merlin/routes/merlinExecutionPlanRoutes.ts`
- `src/merlin/connectorAdapterRuntime.ts`
- `src/merlin/routes/merlinConnectorAdapterRoutes.ts`
- `src/merlin/dryRunExecutorRuntime.ts`
- `src/merlin/routes/merlinDryRunExecutorRoutes.ts`
- `src/merlin/liveExecutionGateRuntime.ts`
- `src/merlin/routes/merlinLiveExecutionGateRoutes.ts`
- `src/merlin/workspaceRuntime.ts`
- `src/merlin/routes/merlinWorkspaceRoutes.ts`
- `src/merlin/profileSeedRuntime.ts`

### LISA and recommendations

- `src/lisa.ts`
- `src/recommendations.ts`
- `src/outcomes.ts`
- `src/replay.ts`
- `src/search.ts`

### Policy and safety

- `src/policy.ts`
- `src/approvalQueue.ts`
- `src/driveSafety.ts`
- `src/operatorIdentity.ts`

### Google Drive and file intake

- `src/driveAuth.ts`
- `src/driveClient.ts`
- `src/driveSafety.ts`
- `src/driveSync.ts`
- `src/driveScheduler.ts`
- `src/driveManifest.ts`
- `src/driveReviewQueue.ts`
- `src/driveIngest.ts`
- `src/fileExtraction.ts`
- `scripts/generate-google-refresh-token.ts`

### MealScout screenshot/intake/profile seed area

- `src/mealscoutDriveIntake.ts`
- `src/mealscoutScreenshotExtraction.ts`
- `src/mealscoutEvidenceClustering.ts`
- `src/mealscoutProfileImport.ts`
- `src/mealscoutPublishPlan.ts`
- `src/mealscoutPublishExecution.ts`
- `src/mealscoutAffiliateFolderAttribution.ts`
- `src/mealscoutAffiliateTrackingLedger.ts`
- `src/mealscoutAffiliateAttributionKpiRollup.ts`
- `src/mealscoutCandidateImport.ts`
- `src/mealscoutOcrAdapter.ts`

### TradeScout seeded profile area

TradeScout seeded contractor-business profiles currently live inside the Merlin profile-seed runtime rather than a separate product adapter file. That is a handoff danger zone and should be documented before refactor.

## Main data and storage model

Primary storage is SQLite via `better-sqlite3`, with each runtime module creating its own tables in the same configured DB path.

Known table groups include:

- Drive manifest: `drive_manifest_entries`.
- Drive review queue decision/audit tables from `driveReviewQueueStore`.
- Recommendations: `recommendations`.
- Legacy outcomes: `outcome_recommendations`, `outcome_records`.
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

Operational flat file:

- Affiliate tracking ledger CSV, default expected path `./data/affiliate-tracking-ledger.csv` unless overridden by environment.

Important in-memory state still exists in some modules, including seeded profile collections and test-oriented runtime state. Treat this as a production-readiness risk until explicitly hardened.

## External integrations

- Google Drive through `googleapis` for OAuth-backed Drive inspection, folder discovery, reconciliation, and intake sync.
- Product verification email webhook through `MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_URL` and optional `MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_TOKEN`.
- Google/Gmail/Calendar/Stripe/Canva are documented target connector lanes, but live connector execution remains gated and should not be assumed enabled from this repo alone.
- GitHub/Codex is implementation workflow context, not an app runtime dependency.
- Local OCR adapter exists for MealScout screenshot processing.

## Deployment and runtime assumptions

- Node version must satisfy `>=20 <25`.
- TypeScript source is under `src`; build output goes to `dist`.
- `npm run build` compiles with `tsc -p tsconfig.json`.
- `npm run check` runs `tsc -p tsconfig.json --noEmit`.
- `npm run test` runs `tsx --test --test-concurrency=1 tests/*.test.ts`.
- Drive/OAuth workflows should use `npm run dev:or` so `.env` is loaded.
- No root `render.yaml` or `Dockerfile` was found during this handoff inspection.
- Production deploy order for DB changes: deploy code that creates tables before enabling any runtime path that depends on those tables. Existing modules use `CREATE TABLE IF NOT EXISTS`, but explicit backup and smoke checks are still required before production use.

## Known danger zones

1. `src/server.ts` is a large route aggregator with many imports and route branches. It is the first file a developer will need to map before touching behavior.
2. MealScout-specific logic and Merlin core logic are now close together. Cleanup must clarify boundaries without rewriting features.
3. Live execution gates exist, but live execution is globally disabled by default. Do not enable live mutation without a separate security review and role-policy gate.
4. Product verification email can call a webhook when configured. Misconfiguration can produce failed sends; it must not fake success.
5. Screenshot profile seeding mutates seeded profile stores and ledger rows. Verification flags must remain false unless normal product verification proves otherwise.
6. Affiliate folder email is credit only. It must not be used as the business/profile email unless evidence extraction independently finds it.
7. Some seeded profile state appears in memory inside runtime modules. Treat as non-final production persistence until documented or migrated.
8. Tests have reported Windows temp-directory cleanup `EPERM` failures in Drive/demo/entity tests. Do not treat those as product logic failures without reproducing.
9. README references policy files that were not found at the root paths inspected: `policies/no-fake-data.md`, `policies/brand-separation.md`, and `policies/financial-actions.md` may be missing or moved.
10. No standard cleanup workflow docs existed at inspection time: `WORKFLOW.md`, `CLEANUP_MAP.md`, and `CODEBASE_PATTERNS_OVERVIEW.md` were missing.

## Validation commands

Fastest safe validation:

```bash
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
8. Run `npm run check`.
9. Run `npm run build`.
10. Run focused tests for the area being touched before full `npm run test`.
11. For Drive work, configure `.env`, use `npm run dev:or`, and validate `/api/drive/auth-health` before mutation tests.
12. For verification email work, configure `MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_URL` and optional token only in the correct environment.
13. Never infer production readiness from smoke tests alone; inspect the relevant ledger/audit output.

## Next cleanup tickets

1. Add `WORKFLOW.md` defining cleanup mode, feature freeze rules, validation ladder, commit discipline, and no-touch zones.
2. Add `CLEANUP_MAP.md` with ordered cleanup tickets and a single current NEXT marker.
3. Add `CODEBASE_PATTERNS_OVERVIEW.md` to document module patterns, runtime table creation pattern, route-handler pattern, test pattern, and safe mutation pattern.
4. Split `src/server.ts` route map into a generated or documented route inventory without changing behavior.
5. Document all environment variables in one `.env.example` or `ENVIRONMENT.md` without adding secrets.
6. Create a schema/table inventory doc from runtime modules and mark which storage is durable SQLite versus in-memory.
7. Document MealScout-specific versus Merlin-core boundary files to reduce accidental cross-brand edits.
8. Add a verification-email transport runbook covering unconfigured, configured, failed, and provider-message-ID cases.
9. Add a Windows test cleanup note or guard for known temp-directory `EPERM` failures.
10. Add a production deploy checklist that explicitly covers DB backup, `npm run check`, `npm run build`, focused tests, Drive health, verification webhook health, and post-deploy smoke.

## No new product features proposed

This handoff spine intentionally proposes cleanup, documentation, validation, and safety-contract work only. It does not propose new user-facing features, new product surfaces, live connector execution, new monetization, payout logic, profile verification shortcuts, or cross-brand behavior changes.
