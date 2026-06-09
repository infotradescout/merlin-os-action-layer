# Merlin Evidence Artifact Storage Policy

## Canonical location

This repository uses `artifacts/` for:

- deterministic provenance summaries
- reproducible QA checkpoints
- short audit payloads
- run-level manifests that support validation and rollback

`artifacts/` is not the place for uncontrolled raw evidence dumps.

## Evidence storage tiers

### Tier 1 — Repo-safe evidence summaries (must stay in repo)

Allowed in `artifacts/`:

- Markdown summaries
- Small JSON artifacts
- Deterministic QA snapshots required for auditability
- Files with line count and size within thresholds

Thresholds:

- **Line count:** <= 500 lines
- **File size:** <= 250 KB
- **Mutation model:** immutable for evidence (`mutationAllowed: false`) unless explicitly documented

### Tier 2 — Raw evidence artifacts (do not keep as long-lived repo source)

Files above thresholds are treated as raw evidence and must be quarantined:

- moved to external storage (Drive/object storage), or
- stored under an explicitly tracked quarantine path with retention metadata, or
- replaced by a compact canonical summary in this repo with an index reference.

Default quarantine thresholds:

- **Line count:** > 5,000 lines
- **Or file size:** > 128 KB

### Canonical index requirement

Every raw artifact must have:

- a manifest entry that records provenance
- the origin artifact generator
- generation timestamp
- hash or checksum
- a canonical repo summary path

## Required raw artifact exception register

Quarantine is required for at least:

- `artifacts/mealscout-menu-artifact-classification/artifact-classification-rows.json` (27,095 lines)
- `artifacts/mealscout-menu-artifact-classification/menu-candidates.json` (11,010 lines)
- `artifacts/mealscout-screenshot-processing-validation/evidence-rows.json` (15,579 lines)
- `artifacts/mealscout-menu-artifact-classification/menu-candidates.csv` (3,774 lines)
- `artifacts/mealscout-screenshot-processing-validation/clean-import-candidates.json` (5,962 lines)
- `artifacts/mealscout-screenshot-processing-validation/evidence-rows.csv` (901 lines)
- `artifacts/mealscout-screenshot-processing-validation/rejected-rows.json` (7,868 lines)
- `artifacts/mealscout-screenshot-processing-validation/rejected-rows.csv` (453 lines)
- `artifacts/mealscout-screenshot-processing-validation/duplicate-groups.json` (2,183 lines) if still raw.
- `artifacts/mealscout-menu-artifact-classification/duplicate-evidence-groups.json` (3,160 lines)
- `artifacts/mealscout-menu-artifact-classification/menu-review-required.json` (2,123 lines)
- `artifacts/mealscout-menu-artifact-classification/menu-review-required.csv` (1,389 lines)

These must be represented by a small, deterministic in-repo summary and an external storage pointer in a future pass.

## Enforcement gates

Merlin governance must enforce:

- no source artifact payload above Tier 2 thresholds remains untracked in core source paths
- no new raw evidence dump in `artifacts/` without a registered index entry
- explicit migration path before large-file accumulation is accepted again
