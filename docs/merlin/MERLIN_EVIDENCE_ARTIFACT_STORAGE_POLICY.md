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

## Required raw artifact quarantine register

The following raw artifacts have been quarantined and replaced in repo by pointer
records at their original paths. The canonical pointer index is:

- `artifacts/quarantine/raw-artifact-pointer-index.json`

Quarantined raw payloads are retained outside tracked source under:

- `.artifact-quarantine/raw-evidence/`

This local quarantine is intentionally ignored by git until an external Drive or
object-storage destination is attached.

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

The same enforcement also pointerizes oversized root-level batch or preview
artifacts, including:

- `pilot7o-truck1-preview.json`
- `pilot7p-preview-check.json`
- `truck1-full-preview-attributed.json`
- `truck1-full-preview.json`
- `truck2-preview.json`
- `truck2-recovery-file-audit.json`

Each pointer record must preserve the original path, quarantine path, SHA-256,
byte size, line count, generation timestamp, pointer index path, and
`mutationAllowed: false`.

## Enforcement gates

Merlin governance must enforce:

- no source artifact payload above Tier 2 thresholds remains untracked in core source paths
- no new raw evidence dump in `artifacts/` without a registered index entry
- explicit migration path before large-file accumulation is accepted again

The deterministic enforcement gate is:

- `scripts/merlin-artifact-quarantine-enforcement.contract.test.mjs`
