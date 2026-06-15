# Merlin Current UX QA Audit

Repo: `Merlin / merlin-os-action-layer`
Branch: `mealscout-screenshot-profile-completion`
Baseline SHA: `798dab5f22b05ee9946eb93825b230ec6e65064e`

Verdict: `PASS_WITH_CONDITIONS`

This is an audit-only Zachary lane for Merlin itself. No refactor, new feature, MealScout apply, approved-export generation, production mutation, RoundTable edit, Albion edit, or Discord config edit was performed.

## Artifact Snapshot

| Artifact area | Current count/status |
| --- | ---: |
| Draft packets | 100 |
| Clean draft candidates | 65 |
| Blocked conflict packets | 7 |
| Owner-confirmation bucket entries | 28 |
| Owner confirmations required | 35 |
| Unknown-held evidence rows | 224 |
| Non-food quarantine rows | 181 |
| Approved draft export present at baseline | yes |
| Approved export `mutationAllowed` | false |
| Approved export `productionApplied` | false |

The approved export artifact is present from the earlier blanket approval state, but it remains non-production. This audit did not regenerate it or alter it.

## Validation Snapshot

| Check | Result |
| --- | --- |
| `npm run check` | passed |
| Targeted artifact/Drive/approval/Discord tests excluding `merlin-intake-engine` | 41/41 passed |
| `tests/merlin-intake-engine.test.ts` isolated | 8/9 failed |
| Failure pattern | Expected Merlin intake endpoints under `/api/merlin/intake/upload-intents` and related paths returned 404; server currently dispatches `/api/merlin/intake`. |

This is a current Merlin QA condition, not a refactor from this audit.

## Merlin UX / Operator Flows Audited

| Area | Result | Evidence | Condition |
| --- | --- | --- | --- |
| Screenshot intake flow | Covered by tests and artifacts | `tests/mealscout-screenshot-extraction.test.ts`, `tests/mealscout-screenshot-processing-validation.test.ts`, `tests/merlin-intake-action-cards-runtime.test.ts`, `tests/merlin-intake-action-cards-dryrun.test.ts` | Full operator browser walkthrough coverage is still thin. |
| Drive intake and file movement | Covered with safety conditions | `tests/drive-sync.test.ts`, `tests/drive-safety.test.ts`, `tests/drive-folder-sequential-inventory.test.ts`, `tests/screenshots-manifest-move-and-seed.test.ts` | Full-folder Drive dry-run evidence should be attached before execute use. |
| Evidence classification outputs | Covered | `tests/mealscout-menu-artifact-classification.test.ts`, `tests/mealscout-evidence-clustering.test.ts`, quarantine/held artifacts | Visual sampling remains manual. |
| Draft packet generation | Covered | `tests/mealscout-draft-packet-generation.test.ts`, `draft-packets.json`, `manifest-summary.json` | Outputs are review-only. |
| Thomas review queue | Covered | `tests/mealscout-thomas-review-queue.test.ts`, `tests/mealscout-thomas-approval-sweep.test.ts`, review queue markdown/JSON | The 65-entry sweep is usable but still lacks a structured decision ledger. |
| Approval/export guard | Guarded with process risk | `tests/mealscout-thomas-approved-draft-export.test.ts`, `src/mealscoutThomasApprovedDraftExport.ts` | Code refuses missing explicit decisions, but the branch already contains a blanket approved export artifact. |
| Merlin intake endpoint contract | Failing current targeted test | `tests/merlin-intake-engine.test.ts`, `src/server.ts`, `src/merlin/routes/merlinIntakeRoutes.ts` | The isolated suite fails 8/9 because expected upload-intent endpoints return 404. This looks like endpoint contract drift or stale test expectations. |
| Discord runtime bridge | Authority boundaries covered | `tests/roundtable-discord.test.ts`, `src/roundtableDiscord.ts` | File remains mixed-responsibility for future cleanup. |
| Server route error handling | Behavior covered, maintainability risk | `src/server.ts`, Merlin route modules | Shared response/error helpers should wait for parity tests. |
| Duplicated scripts | Maintainability risk | screenshot, draft, queue, sweep, export generators | Artifact IO and markdown/summary rendering are repeated. |
| Large mixed files | High DRY/SRP risk | `src/server.ts`, `src/lisa.ts`, `src/merlin/affiliateScreenshotFolderProcessing.ts`, `src/merlin/intake/actionCardQueue.ts`, `public/mealscout-review-queue.html` | Refactor only after behavior-parity evidence. |
| Test coverage gaps | Gaps identified | test tree and package scripts | No single Zachary-style release gate inventories every operator state. |
| Markdown/JSON artifact usability | Usable with conditions | summary, audit, review queue, clean sweep artifacts | No unified operator index links status, owner, next decision, and source artifacts. |

## Critical / High Issues

Critical: none found. No live production mutation or MealScout apply issue was found in this audit.

High:

1. `MERLIN-QA-001`: Approved export artifact is present from a blanket approval state, even though it is non-production.
   Impact: operators may confuse export presence with completed visual review.
   Recommendation: add an operator-visible review-decision ledger or require per-candidate decision annotations before treating the export as downstream-ready.

2. `MERLIN-QA-002`: No unified Zachary release gate exists for Merlin operator surfaces.
   Impact: screen inventory, clickables, loading/empty/error/success states, responsive checks, console checks, and API-failure checks remain spread across tests and manual artifacts.
   Recommendation: create a Merlin QA evidence packet generator before refactoring UI or routes.

3. `MERLIN-QA-003`: Server routing is concentrated in `src/server.ts`, currently 4597 lines.
   Impact: route behavior is harder to audit, and repeated error handling increases regression risk.
   Recommendation: pin route parity tests, then extract route groups and shared response/error helpers incrementally.

4. `MERLIN-QA-004`: Large static operator pages carry mixed UI, state, and API behavior.
   Impact: review screens can drift without a full real-user QA inventory.
   Recommendation: inventory and test public review screens before extracting shared browser helpers.

5. `MERLIN-QA-005`: Merlin intake engine endpoint contract is failing current targeted tests.
   Impact: upload intent, flags, actions, route, and preview endpoint expectations return 404 in the isolated suite, so current operator intake behavior is not proven by that test.
   Recommendation: before refactoring intake, decide whether the current route contract is `/api/merlin/intake` or the upload-intents contract should be restored, then update code/tests with behavior-parity evidence.

## Recommended Next Merlin Lanes

1. Create a Merlin QA evidence packet schema and generator for operator flows.
2. Resolve Merlin intake endpoint contract drift shown by `tests/merlin-intake-engine.test.ts`.
3. Run a real-user browser QA pass across public operator screens and capture screenshots, console output, and API failures.
4. Add route parity tests around high-risk `src/server.ts` route groups.
5. Plan behavior-preserving extraction of route response/error helpers.
6. Plan behavior-preserving extraction of shared artifact IO and markdown rendering helpers.
