# MealScout Screenshot-to-Draft Profile Top-Down Audit

- Repo: Merlin / merlin-os-action-layer
- Branch: mealscout-screenshot-profile-completion
- Baseline SHA: e046deadbbf1acb93474213bff104f2b25e7d8c2
- Observed HEAD at audit start: ec74a7bac55bff503b52ed8006d5395275eb5f91
- Mode: audit only
- Verdict: PASS WITH CONDITIONS

Condition: the requested baseline is an ancestor, but the branch already contains the later approved-draft export commit `ec74a7b`. This audit did not create or advance approval, export, apply, or production work. The approved-export artifact is treated as out of scope for deciding whether Thomas can review the 65 clean candidates.

## 1. Repo Integrity

Result: PASS WITH CONDITIONS

- Current branch is `mealscout-screenshot-profile-completion` and tracks `origin/mealscout-screenshot-profile-completion`.
- Worktree was clean before the audit artifacts were created.
- Baseline `e046deadbbf1acb93474213bff104f2b25e7d8c2` is an ancestor of current HEAD.
- One post-baseline commit exists: `ec74a7b feat: export thomas approved mealscout drafts`.
- No RoundTable, Albion, Discord, or live MealScout production code was edited for this audit.

## 2. Artifact Chain Consistency

Result: PASS

Audited artifacts:

- `draft-packets.json`
- `manifest-summary.json`
- `non-food-quarantine.json`
- `unknown-held.json`
- `summary.md`
- `thomas-review-queue.json`
- `thomas-review-queue.md`
- `thomas-clean-candidate-approval-sweep.json`
- `thomas-clean-candidate-approval-sweep.md`

Counts agree across the chain:

- Draft packets: 100
- Evidence rows read: 896
- Non-food quarantined: 181
- Unknown held: 224
- Review queue clean candidates: 65
- Review queue blocked conflicts: 7
- Review queue owner-confirmation-required total: 35
- Review queue owner-confirmation bucket: 28
- Low confidence / visual review bucket: 0
- Approval sweep clean candidates included: 65

## 3. Bucket Math

Result: PASS

- All 100 draft packets are bucketed exactly once across clean, conflict, owner-confirmation, and low-confidence buckets.
- Unique bucketed draft packets: 100.
- Duplicate bucket assignments: 0.
- Missing draft packets from review buckets: 0.
- Extra review bucket IDs not present in draft packets: 0.
- Clean versus conflict overlap: 0.
- Clean versus owner-confirmation overlap: 0.
- Clean versus low-confidence overlap: 0.
- Approval sweep versus conflict overlap: 0.
- Approval sweep versus owner-confirmation overlap: 0.
- Approval sweep source evidence versus unknown-held overlap: 0.
- Approval sweep source evidence versus non-food quarantine overlap: 0.

## 4. Evidence Linkage

Result: PASS

For all 65 clean candidates:

- Source evidence IDs exist.
- Source filenames exist.
- Extracted visible facts are present.
- Missing facts are explicit.
- Confidence is present.
- No clean candidate source evidence overlaps unknown-held or non-food quarantine rows.

Important limit: this audit verifies that facts are carried from OCR-backed draft packet fields and source evidence references. It does not visually re-OCR the original screenshots.

## 5. Conflict Handling

Result: PASS

- Conflict packets: 7.
- Conflicts found: 9.
- All conflict packets are in `blocked_by_conflict`.
- All conflict packets are excluded from clean candidates and the clean approval sweep.

Conflict packet fields:

- `ms-draft-packet-49768d4e5dcd3954`: businessName, instagram
- `ms-draft-packet-9140f308e08cd09c`: businessName
- `ms-draft-packet-b68f91e47f3c97d7`: businessName
- `ms-draft-packet-8a276504564af9a0`: businessName
- `ms-draft-packet-8f9f34ac03f69262`: businessName
- `ms-draft-packet-5ac14b9e381812de`: businessName, locationAddress
- `ms-draft-packet-e8edbca4a36f8588`: locationAddress

## 6. Owner Confirmation Handling

Result: PASS

- Owner-confirmation-required packets: 35.
- Owner-confirmation bucket entries: 28.
- Owner-confirmation packets that also have conflicts: 7.

Why 35 maps to 28: bucket assignment is intentionally prioritized. Seven owner-confirmation-required packets also have conflicts, so they are placed in `blocked_by_conflict` rather than duplicated in `owner_confirmation_required`. The remaining 28 non-conflict owner-confirmation packets form the owner-confirmation bucket. All 35 are excluded from the clean approval sweep.

## 7. Food / Non-Food Quarantine Safety

Result: PASS

- Non-food quarantine rows: 181.
- Unknown-held rows: 224.
- Non-food rows remain quarantined.
- Unknown-held rows remain held.
- Clean candidate source evidence overlap with non-food quarantine: 0.
- Clean candidate source evidence overlap with unknown-held: 0.

No contractor/trade evidence appears in the 65 clean MealScout candidates by source evidence ID overlap.

## 8. Mutation Safety

Result: PASS

- `draft-packets.json`: every draft packet has `mutationAllowed: false` and `productionApplied: false`.
- `thomas-review-queue.json`: `liveMealScoutMutation: false`.
- `thomas-clean-candidate-approval-sweep.json`: `liveMealScoutMutation: false`.
- No profile/menu/schedule/logo apply artifact is produced by the audited chain.
- No live MealScout profile mutation is performed by these artifact generators.
- No production claims are made by the audited chain.

Repo search note: the broader repo contains older Merlin/MealScout apply and publish code outside this artifact chain. That code is not invoked by the audited draft packet, review queue, or clean sweep artifacts.

## 9. Test Adequacy

Result: PASS WITH CONDITIONS

Existing targeted tests:

- `tests/mealscout-draft-packet-generation.test.ts`
  - Proves review-only food vendor packet generation from visible OCR facts.
  - Proves non-food quarantine and unreadable/unknown hold behavior.
  - Proves conflict blocking and owner confirmation.
  - Proves filenames are not used as business facts without visible OCR support.
  - Proves tracker rows define draft packet boundaries.

- `tests/mealscout-thomas-review-queue.test.ts`
  - Proves all generated draft packets are included in review queue accounting.
  - Proves conflict-blocked drafts are not clean candidates.
  - Proves owner-confirmation drafts bucket correctly.
  - Proves unknown-held and non-food quarantine outputs are preserved.
  - Proves no production/apply flags are introduced.

- `tests/mealscout-thomas-approval-sweep.test.ts`
  - Proves exactly 65 clean candidates are included.
  - Proves blocked, owner-confirmation, unknown-held, and non-food records are excluded.
  - Proves source evidence and visible facts are present.
  - Proves no production/apply flags are introduced.

Remaining untested risks:

- OCR quality is not visually revalidated against source screenshots.
- Some clean candidates show suspicious OCR-derived social/contact values and need Thomas visual review.
- The approval sweep is a static Markdown/JSON artifact, not an interactive review UI.
- Future Thomas annotations need a separate audit before any approved export or apply lane.

## 10. Thomas Review Usability

Result: PASS WITH CONDITIONS

Thomas can review the 65 clean candidates without raw JSON. The Markdown has 65 numbered candidate sections, and each candidate includes source screenshots, extracted visible facts, missing facts, confidence, recommendation, reason, and non-production warning.

Recommended improvements before heavy manual review:

- Add checkbox lines for `approve_draft`, `hold_for_more_evidence`, `wrong_business_name`, `duplicate_existing_profile`, and `quarantine`.
- Add a red-flag line for suspicious OCR values, especially social handles parsed from email domains.
- Add Drive hyperlinks where source Drive URLs are available, not only file IDs.
- Add a one-page summary sorted by confidence and missing-fact count.

## Bottom Line

It is safe for Thomas to start reviewing the 65 clean candidates as draft candidates only.

It is not safe to apply anything to live MealScout from this audit. No MealScout production mutation should occur until Thomas decisions are explicitly captured and a separate apply-gated lane is authorized.
