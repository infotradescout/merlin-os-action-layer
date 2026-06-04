# Merlin OR Handoff Spine

## App Identity

Merlin OR / Merlin OS Action Layer is the controlled action-layer service for Merlin OS. It receives business intent, assigns it to an explicit brand lane, checks policy and source-of-truth context, exposes operator review surfaces, and records auditable outcomes.

Repository: `infotradescout/merlin-os-action-layer`.

Runtime entrypoint: `src/server.ts`, started locally with `npm run dev` or `npm run dev:or`.

Default service name and port come from `src/constants.ts`: `merlin-or` on port `3030`.

## What This App Is

- A Node/TypeScript HTTP service with static operator pages in `public/`.
- A brand-safe action and review layer for Merlin, MealScout, TradeScout, and related LISA/Drive context.
- A SQLite-backed local runtime for action cards, approvals, outcomes, intake, entity memory, Drive manifests, replay, review decisions, and role policy checks.
- An operator-facing coordination surface for review queues, Drive safety checks, MealScout intake review, action-card workflow, and controlled audit trails.
- A place where safety policy, permission boundaries, and auditability are enforced before live connector or mutation paths are used.

## What This App Is Not

- Not a general chatbot or prompt library.
- Not the primary product UI for MealScout, TradeScout, or Trader's Corner customers.
- Not a Stripe billing backend, payment processor, payout engine, or banking ledger.
- Not a Google Drive cleanup bot that should delete, archive, trash, publish, or route files without explicit existing guardrails.
- Not a source of fake users, fake events, guessed recipients, sample production records, or synthetic product data.
- Not a place to add new product features during production cleanup / handoff mode.

## Brand Boundaries

- Merlin: orchestration, intake, action-card, workspace, approval, dry-run, live-execution-gate, connector-adapter, entity-memory, search, and outcome runtime.
- MealScout: food truck/vendor/event-host workflows, screenshot/intake processing, review queue, profile import, publish planning/execution, affiliate attribution, and money-flow documentation.
- TradeScout: contractor/homeowner lane and contractor profile seeding where current runtime supports it.
- Trader's Corner: separate trading/sports lane. It is documented as separate/inactive unless explicitly selected and must not be crossed with MealScout or TradeScout behavior.

## Core Operator Flows

- Daily/operator overview: static index page calls health, daily, LISA, Drive status, and review endpoints.
- Drive safety and review queue: Drive files are imported/synced, represented in a manifest, surfaced for operator review, and routed only through existing auth and mutation guardrails.
- MealScout review queue: operators review extracted screenshot/intake evidence, make metadata/correction/attachment decisions, inspect batches, and use existing guarded publish-plan paths.
- Merlin intake/action-card loop: intake items can generate action cards, action cards flow through approval, execution-plan, dry-run, live-execution-gate, and outcome records.
- Entity memory/search: Merlin entity memory and evidence index endpoints resolve entities, conflicts, source observations, and search results when enabled.
- Profile seeding and verification email: current runtime can process existing screenshots into seeded MealScout/TradeScout profile records and verification email records; cleanup work must document this path only.
- Affiliate attribution: current MealScout affiliate ledger/KPI/report paths write and summarize attribution data; cleanup work must document this path only.

## Entry Routes And Pages

- `/` and `/index.html`: main static operator page from `public/index.html`.
- `/admin/drive-review-queue`: Drive review queue page from `public/drive-review-queue.html`.
- `/admin/drive-review-queue-client.js`: Drive review queue client module.
- `/admin/mealscout-review-queue`: MealScout review queue page from `public/mealscout-review-queue.html`.
- `/admin/mealscout-review-queue-client.js`: MealScout review queue client module.

This repo is not API/service-only. It includes static client/router entry points under `public/`, served directly by `src/server.ts`.

## Server Route And API Groups

- Health/daily/search: `GET /api/health`, `GET /api/daily`, `GET /api/search`.
- LISA/events/replay: `/api/lisa/*`, `/api/events/tradescout`, `/api/events/mealscout`, `/api/events/crawlability`, `/api/changes/recent`, `/api/replay/recent`.
- Legacy approvals/demo: `/api/approvals/*`, `/api/demo/reset`, `/api/demo/seed-tradescout-loop`.
- Drive import/sync/safety/review: `/api/drive/import-file`, `/api/drive/sync`, `/api/drive/auth-health`, `/api/drive/reconciliation`, `/api/drive/review-queue*`, `/api/drive/status`, `/api/drive/manifest`, `/api/drive/needs-review`, `/api/drive/review/:drive_file_id/route`, `/api/drive/review/:drive_file_id/mark`, `/api/drive/file/:drive_file_id/attach-entity`, `/api/drive/file/:drive_file_id/entity-suggestions`.
- MealScout intake/review/publish: `/api/mealscout/intake/*`, `/api/mealscout/profile-import/batches`, `/api/mealscout/review-decisions*`, `/api/mealscout/review-corrections`, `/api/mealscout/attachment-decisions`, `/api/mealscout/batches/:batch_id/*`, `/api/mealscout/drafts/*`.
- Merlin profile seeding: `/api/merlin/profile-seeding/process-existing-screenshots`, `/api/merlin/profile-seeding/tradescout-profiles`, `/api/merlin/profile-seeding/verification-emails`.
- Merlin modular routes: `/api/merlin/operator-console*`, `/api/merlin/intake*`, `/api/merlin/action-cards*`, `/api/merlin/entities*`, `/api/merlin/source-observations`, `/api/merlin/outcomes*`, `/api/merlin/kpi-rollup`, `/api/merlin/approvals*`, `/api/merlin/execution-plans*`, `/api/merlin/connector-adapters*`, `/api/merlin/dry-run-executions*`, `/api/merlin/live-execution-gates*`, `/api/merlin/workspaces*`, `/api/merlin/role-policy-checks`, `/api/merlin/search`.

Main route wiring is split between direct `src/server.ts` conditionals and modular handlers in `src/merlin/routes/*`.

## Main Data And Storage Model

- SQLite database path: defaults to `data/merlin-or.sqlite`; override with `MERLIN_DB_PATH`.
- LISA state: `events`, `timeline_entries`, `entity_state`.
- Recommendation/approval/outcome/replay runtime: `recommendations`, `approvals`, `outcome_recommendations`, `outcome_records`, `replay_events`.
- Drive storage/review: `drive_manifest_entries`, `drive_review_queue_decisions`, and in-memory Drive drift replay dedupe state.
- Merlin runtime: `merlin_intake_items`, `merlin_intake_item_history`, `merlin_intake_action_card_links`, `merlin_action_cards`, `merlin_action_card_history`, `merlin_approvals`, `merlin_approval_history`, `merlin_execution_plans`, `merlin_execution_plan_history`, `merlin_dry_run_executions`, `merlin_dry_run_execution_history`, `merlin_live_execution_gates`, `merlin_live_execution_gate_history`, `merlin_outcomes`, `merlin_outcome_history`, `merlin_connector_adapters`, `merlin_connector_adapter_checks`.
- Merlin entity/workspace memory: `merlin_entities`, `merlin_entity_identifiers`, `merlin_entity_aliases`, `merlin_entity_conflicts`, `merlin_source_observations`, `merlin_entity_history`, `merlin_workspaces`, `merlin_workspace_members`, `merlin_workspace_brand_permissions`, `merlin_role_policy_checks`.
- Merlin intake action-card queue: `merlin_intake_action_cards`.
- MealScout affiliate ledger: CSV path defaults to `data/mealscout-affiliate-tracking-ledger.csv`; override with `MEALSCOUT_AFFILIATE_TRACKING_LEDGER_PATH`.
- Process-local runtime exists for some paths, including profile seeding verification email records and some test/runtime helpers. Confirm persistence before assuming restart durability.

## External Integrations

- Google Drive: `googleapis`, OAuth/service-account/manual mode, Drive auth health, managed folders, manifest, sync, routing, duplicate removal guardrails.
- Google OAuth env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN`, optional `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`.
- Merlin Drive env: `MERLIN_DRIVE_MODE`, `MERLIN_DRIVE_SYNC_ENABLED`, `MERLIN_DRIVE_ROOT_MODE`, `MERLIN_DRIVE_ROOT_FOLDER_NAME`, `MERLIN_DRIVE_ROOT_FOLDER_ID`, `MERLIN_DRIVE_SYNC_MODE`, `MERLIN_DRIVE_SYNC_INTERVAL_MINUTES`, `MERLIN_DRIVE_BOOTSTRAP_ENABLED`, `MERLIN_DRIVE_CREATE_MISSING_FOLDERS`.
- OCR/image extraction: Tesseract path can be provided with `TESSERACT_PATH`; image/PDF support is constrained by current adapters.
- Product verification email webhook: `MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_URL`, optional `MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_TOKEN`.
- Operator identity: trusted request headers and `MERLIN_OPERATOR_ID`; role may use `MERLIN_OPERATOR_ROLE`.
- MealScout affiliate mapping and ledger: `MEALSCOUT_AFFILIATE_EMAIL_MAP`, `MEALSCOUT_AFFILIATE_TRACKING_LEDGER_PATH`.
- Dangerous duplicate trash mode: `MEALSCOUT_ENABLE_DANGEROUS_TRASH_MODE=true` is required before trash mode is allowed.
- Stripe, Gmail, Calendar, Canva: referenced as action-layer domains in docs; do not assume live connector execution without locating the current adapter and guard path.

## Deployment And Runtime Assumptions

- No deployment config was found in the repo root or common deployment filenames during this inspection.
- `package.json` defines `dev`, `dev:or`, `start`, `build`, `check`, `test`, `test:browser`, and `drive:auth:token`.
- `npm run dev:or` loads `.env` through `dotenv-cli` before running `tsx watch src/server.ts`.
- `npm run build` compiles TypeScript to `dist/`; `npm start` runs `node dist/server.js`.
- `PORT` overrides the default `3030`.
- `MERLIN_RUNTIME=test` suppresses server auto-start in tests and unlocks test reset helpers in selected modules.
- There is no explicit migration runner. Tables are created by runtime modules with `CREATE TABLE IF NOT EXISTS`; document deploy order before changing storage contracts.

Deploy order if storage changes are ever required:

1. Document the table/column/index change and rollback expectation.
2. Add contract tests around existing behavior first.
3. Add a migration or runtime compatibility path.
4. Deploy code that can read old and new shapes.
5. Backfill only after read compatibility is live.
6. Remove compatibility only in a later cleanup after validation.

## Known Danger Zones

- Profile seeding, verification email, affiliate ledger, Drive mutation, publish, cleanup/delete/archive, payout, and live connector execution behavior are production-sensitive. In handoff cleanup mode, document current behavior only.
- Drive route/sync/mutation paths must keep auth-health and managed-folder guardrails.
- MealScout duplicate removal has an explicit dangerous trash env gate; do not bypass it.
- Publish-plan execution is a live business mutation path and requires existing role/approval boundaries.
- Verification email recipients must come from extracted business/profile evidence according to the current path, not affiliate folders or guessed data.
- Affiliate attribution is not payout. Do not turn attribution/KPI records into payment behavior.
- Trader's Corner must remain separate from MealScout and TradeScout.
- `.env` may contain real credentials. Do not copy secrets into docs, tests, reports, or commits.
- The current worktree may contain local reports, smoke artifacts, and untracked generated outputs. Do not treat them as product fixtures.

## Existing Workflow Docs Inspection

- `README.md`: exists.
- `WORKFLOW.md`: missing.
- `CLEANUP_MAP.md`: missing.
- `CODEBASE_PATTERNS_OVERVIEW.md`: missing.
- Repo doctor script: not found in `package.json` or `scripts/`.
- Deployment config: not found in common repo-root deployment files during this inspection.
- Client/router entry: exists. Static pages are in `public/`, and server route wiring is in `src/server.ts` plus `src/merlin/routes/*`.

## Validation Commands

Run these for handoff-spine cleanup:

```bash
node scripts/merlin-or-handoff-spine.contract.test.mjs
npm run check
npm run build
```

Run only if the environment is safe and time allows:

```bash
npm run test
npm run test:browser
```

Operational smoke checks when a local server is running:

```bash
curl -s http://localhost:3030/api/health
curl -s http://localhost:3030/api/drive/auth-health
curl -s http://localhost:3030/api/drive/reconciliation
```

## Developer Onboarding Checklist

- Read `README.md`, this handoff spine, `docs/OPERATIONS_RUNBOOK.md`, `docs/DRIVE_SAFETY_LAYER.md`, `docs/DRIVE_REVIEW_QUEUE_V2_5.md`, `docs/REVIEW_QUEUE_AUDIT_LEDGER.md`, `docs/brand-lanes.md`, `docs/permissions.md`, and `docs/mealscout-money-flows.md`.
- Run `npm install` if dependencies are not already present.
- Run `node scripts/merlin-or-handoff-spine.contract.test.mjs`, `npm run check`, and `npm run build`.
- Start locally with `npm run dev` for non-Drive work or `npm run dev:or` for `.env`/Drive OAuth work.
- Open `/`, `/admin/drive-review-queue`, and `/admin/mealscout-review-queue` to understand operator surfaces.
- Inspect `src/server.ts` route groups before touching any route.
- Inspect `src/merlin/routes/*` and matching runtime files before touching Merlin modular APIs.
- Inspect `src/drive*` before touching Drive auth, manifest, sync, routing, or safety behavior.
- Inspect `src/mealscout*` before touching MealScout intake, review, affiliate, publish, or OCR behavior.
- Confirm whether a path is SQLite-backed, CSV-backed, process-local, or external-connector-backed before assuming durability.

## Next Cleanup Tickets

No new product features are proposed by this handoff spine; cleanup tickets are documentation, inventory, validation, or contract-test work only.

- Cleanup: Create a `WORKFLOW.md` that links to this spine and documents the current inspect-build-test-handoff workflow without changing runtime behavior.
- Cleanup: Create a `CLEANUP_MAP.md` that maps modules to owner domain, storage, route group, tests, and danger-zone status.
- Cleanup: Create a `CODEBASE_PATTERNS_OVERVIEW.md` covering route-handler style, response envelopes, SQLite initialization, role checks, and test naming conventions.
- Cleanup: Add a repo doctor script that performs read-only environment and file presence checks, then document it in `package.json` and this spine.
- Cleanup: Inventory all root-level smoke/report artifacts and classify keep/archive/ignore candidates without deleting anything.
- Cleanup: Add route inventory contract tests for `src/server.ts` and `src/merlin/routes/*` to preserve current API group visibility.
- Cleanup: Add storage inventory contract tests that assert documented SQLite table names remain discoverable in runtime modules.
- Cleanup: Document deployment assumptions and production env requirements in a dedicated operations doc once the hosting target is known.
