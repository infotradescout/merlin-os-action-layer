# MealScout Seed Live Apply Operator Runbook

This runbook is the human-control layer for the first real MealScout seed live apply.

Do not run live apply until explicit human approval is given.

Current baseline:

- Commit: `56415bf Add MealScout seed apply simulation report`
- Batch: `BATCH-001-MEALSCOUT-MERLIN-SEED`
- Expected checksum: `b69bbc0dc150dc33667bb05eb5f8349dc3961f023919d20c62ac9a261067d2b3`
- Expected dry-run values: `mutationAllowed:false`, `eligibleRowCount:2`, `blockedRowCount:0`
- Live apply/import status before this runbook: no live apply/import has run

## Preflight Commands

Run these commands before any go/no-go discussion:

```powershell
git status --short
git status -sb
git log -1 --oneline
npm run test:contracts
npm run lint
npx tsx --test tests/mealscout-seed-import-readiness.test.ts
npx tsx scripts/mealscout-seed-import-readiness.ts
```

Expected repository state:

- `git status --short` returns no output.
- `git status -sb` shows `main...origin/main` with no ahead/behind markers.
- `git log -1 --oneline` shows `56415bf Add MealScout seed apply simulation report`.
- All validation commands pass.
- The readiness script reports `mutationAllowed:false`, `eligibleRowCount:2`, `blockedRowCount:0`, and checksum `b69bbc0dc150dc33667bb05eb5f8349dc3961f023919d20c62ac9a261067d2b3`.

## Required Artifacts

All four artifacts must exist and be reviewed before approval:

- `artifacts/mealscout-seed-import-readiness/batch001-dry-run-review.json`
- `artifacts/mealscout-seed-import-readiness/batch001-dry-run-review.md`
- `artifacts/mealscout-seed-import-readiness/batch001-apply-simulation-report.json`
- `artifacts/mealscout-seed-import-readiness/batch001-apply-simulation-report.md`

The dry-run artifact and simulation report must both use checksum `b69bbc0dc150dc33667bb05eb5f8349dc3961f023919d20c62ac9a261067d2b3`, matching the current seed export.

## Scope

Only `BATCH-001-MEALSCOUT-MERLIN-SEED` rows are eligible. Do not apply rows from review, blocked, contractor, or any other screenshot-routing batch.

Expected row count:

- Eligible rows: `2`
- Blocked rows: `0`

Any different count is a stop condition.

## Evidence And Provenance

Copied evidence file ID is import identity.

Original source file ID is audit-only provenance.

The copied evidence ID and original source ID must remain separate in the dry-run artifact, simulation report, and any eventual post-apply report.

## Field Safety

Blank/null fields must never overwrite populated profile fields.

Only nonblank field writes from the reviewed plan may be applied. Omitted blank/null fields must stay omitted in the live apply report.

## Authorization

Live apply requires both:

- Explicit human go/no-go approval.
- Explicit `allowLiveApply=true`.

The command shape must remain guarded and must not be run until approved:

```powershell
# DO NOT RUN UNTIL APPROVED.
# Example only: live apply requires explicit human approval and allowLiveApply=true.
npx tsx scripts/mealscout-seed-import-readiness.ts --simulate-apply --allow-live-apply
```

If the actual live-apply command changes in code later, this runbook must be updated before approval. The final live command must require `allowLiveApply=true`, an existing dry-run review artifact, a matching checksum, and a post-apply report path.

## Post-Apply Report

Apply cannot be considered successful unless a post-apply report is written and reviewed.

The post-apply report must include:

- Batch ID.
- Run mode.
- Mutation status.
- Checksum used.
- Eligible row count.
- Blocked row count.
- Per-row create/update result.
- Matched existing profile ID/name when applicable.
- Field writes for nonblank values only.
- Omitted blank/null fields.
- Copied evidence file ID used as evidence identity.
- Original source file ID used only as provenance.
- Post-apply status per row.

## Stop Conditions

Stop immediately if any condition is true:

- Dirty repo.
- Branch not synced with `origin/main`.
- Wrong latest commit.
- Validation failure.
- Missing dry-run artifact.
- Missing simulation artifact.
- Checksum mismatch.
- Eligible row count not `2`.
- Blocked row count not `0`.
- `mutationAllowed` not `false` during preflight.
- Unexpected create/update actions.
- Missing post-apply report path.
- Copied evidence ID and original source ID are the same.
- Original source file ID is treated as import identity instead of audit-only provenance.
- Blank/null field is present as a planned overwrite.

## Rollback/Fix-Forward

Do not delete evidence.

Preserve the post-apply report.

Use the generated report to identify exact affected profiles, field writes, evidence IDs, and provenance IDs.

Prefer compensating correction over destructive rollback. If a correction is needed, create a follow-up action that references the post-apply report and updates only the affected fields.

If evidence, provenance, or row-count identity is unclear, stop and do not attempt cleanup by deletion.
