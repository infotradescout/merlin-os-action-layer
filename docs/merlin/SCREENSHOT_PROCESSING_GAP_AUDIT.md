# Screenshot Processing Gap Audit

## Scope

This audit reviews existing Merlin repository capabilities related to screenshot intake, extraction, evidence handling, review, and apply eligibility before any new screenshot-processing build lane is opened.

This is an audit-only artifact. It does not authorize new runtime behavior.

Baseline reviewed for this lane: `6b99f5ca4ab2818b891d5cca32f90eec275752b1`

## Existing Capabilities Found

| File path | Exported function/type/schema/test | What it already supports |
| --- | --- | --- |
| `src/merlin/intake/intakeTypes.ts` | `UploadIntent`, `UploadIntentFileRef`, `RoutingDecision`, `HeldRoutingReviewPacket`, `HeldRoutingApplyEligibility`, `HeldRoutingExplicitApplyApproval`, `HeldRoutingFinalExecutorPreview`, `HeldRoutingFinalExecutorDryRunPlan`, `HeldRoutingOperatorReviewSummary`, `HeldRoutingOperatorReviewPresentation`, `PreviewPacket` | Defines a read-only Merlin intake contract for file-backed review chains, held-routing packets, explicit apply approval, final executor preview, dry-run planning, and evidence-bound presentation artifacts. |
| `src/merlin/intake/router.ts` | `routeUploadIntentFiles` | Performs deterministic destination routing for uploaded files into `menu`, `schedule`, `logo`, `photo`, `document`, or held states with confidence and reason codes. Blocks cross-domain evidence by holding wrong-domain MealScout uploads. |
| `src/merlin/intake/reviewPackets.ts` | `buildHeldRoutingReviewPackets`, `applyHeldRoutingOperatorDecision`, `evaluateHeldRoutingApplyEligibility`, `createHeldRoutingExplicitApplyApproval`, `createHeldRoutingFinalExecutorPreview`, `createHeldRoutingFinalExecutorDryRunPlan` | Builds a deterministic review/apply-eligibility chain for held routing. Prevents auto-execution, requires explicit approval, and keeps execution flags hard false. |
| `src/merlin/intake/operatorReviewPresentation.ts` | `createHeldRoutingOperatorReviewPresentation`, `serializeHeldRoutingOperatorReviewPresentation` | Produces read-only operator review presentations with evidence bindings, approval-gate preview, and approval-artifact preview. Supports proof-oriented advisory review without mutation. |
| `src/merlin/intake/previewBuilder.ts` | `buildPreviewPacket` | Produces mutation-safe preview packets with source file refs, confidence, hold reasons, allowed fields, and forbidden fields. |
| `src/merlin/intake/approvalGate.ts` | `MerlinApprovalDecision` type | Documents that final apply/publish execution remains intentionally out of scope in this layer. |
| `src/merlin/intakeRuntime.ts` | `createMerlinIntakeItem`, `listMerlinIntakeItems`, `getMerlinIntakeItemById`, `updateMerlinIntakeStatus`, `updateMerlinIntakeEntityResolution`, `listMerlinIntakeHistory`, `generateActionCardsFromMerlinIntakeItem`, `searchMerlinIntakeItems` | Stores generic Merlin intake records, status history, entity-resolution metadata, and action-card links. Supports audit history for intake items but not screenshot extraction itself. |
| `src/merlin/routes/merlinIntakeRoutes.ts` | `handleMerlinIntakeRoute` | Exposes generic intake CRUD/history/action-card endpoints. Supports intake records from `upload`/`drive` sources but not screenshot-specific extraction orchestration. |
| `src/merlin/affiliateScreenshotFolderProcessing.ts` | `preflightAffiliateScreenshotFolders`, `processAffiliateScreenshotFolders`, `buildMerlinProfileSeedExportBundle`, `renderAffiliateScreenshotFolderProcessingReport`, `renderAffiliateScreenshotFolderPreflightReport` | Scans local or Drive-backed screenshot folders, detects affiliate attribution from folder naming, performs dry-run vs apply modes, emits deterministic text reports, and can export compact handoff rows for seeded profiles. |
| `src/merlin/profileSeedRuntime.ts` | `processExistingScreenshotsIntoSeededProfiles`, `listTradeScoutSeededProfiles`, `listTradeScoutAutoOnboardedProfiles`, `listTradeScoutClaimedRegisteredProfiles`, `listVerificationEmailRecords` | Uses screenshot text and labels to infer MealScout vs TradeScout, extract profile identity, seed or update brand-specific profiles, and record verification-email activity. This is existing screenshot apply behavior, but it is product-specific and mutative. |
| `src/merlin/governance/workflowPacketChain.ts` | `createGovernanceWorkflowPacketChain` | Generates deterministic governance packets that separate confirmed facts, operator claims, assumptions, missing evidence, and required approvals. Useful as governance precedent for future screenshot-processing packets. |
| `src/fileExtraction.ts` | `extractSupportedFile` (verified via tests) | Supports text, markdown, JSON, and CSV extraction. For screenshots and images it returns `unsupported`; for PDFs it returns `metadata_only`. This is an important current limit. |
| `docs/merlin/MERLIN_EVIDENCE_ARTIFACT_STORAGE_POLICY.md` | Policy doc | Defines repo-safe evidence summary rules, raw artifact quarantine rules, canonical pointer/index requirements, and deterministic evidence storage thresholds. |
| `docs/ai-build-process/SERVED_REALITY_CHECKLIST.md` | Checklist doc | Defines evidence expectations before declaring completion for production-facing slices. Relevant for future screenshot-processing apply lanes. |
| `tests/merlin-intake-review-packets.test.ts` | test file | Verifies deterministic held-routing review packet generation for ambiguous screenshot-like uploads and intent/evidence conflicts. |
| `tests/merlin-intake-explicit-apply-approval.test.ts` | test file | Verifies explicit apply approval is required, deterministic, and blocked on packet mismatch, missing operator identity, or unsafe flags. |
| `tests/merlin-intake-final-executor-dry-run-plan.test.ts` | test file | Verifies final executor remains preview-only and dry-run only, with hard refusals for packet mismatch, approval mismatch, execution flags, and missing IDs. |
| `tests/upload-intent-packet.test.ts` | test file | Verifies upload-intent snapshots, screenshot/file routing bias, held wrong-domain evidence, and mutation-safe preview responses. |
| `tests/merlin-intake-runtime.test.ts` | test file | Verifies generic intake item persistence, status/history tracking, and read-only action-card generation from intake records. |
| `tests/merlin-affiliate-screenshot-folder-processing.test.ts` | test file | Verifies screenshot folder preflight/apply behavior, affiliate attribution, report output, max-file caps, admin-flow fallback, and export bundle generation. |
| `tests/mealscout-screenshot-extraction.test.ts` | test file | Verifies MealScout screenshot text parsing, type classification, mutation-safe preview behavior, Drive-loaded text fallback, and opt-in OCR diagnostics in the MealScout-specific preview path. |
| `tests/file-extraction.test.ts` | test file | Verifies current extraction support boundaries, including image unsupported and PDF metadata-only behavior. |

## Missing Capabilities

| Exact missing behavior | Why it blocks screenshot processing | Recommended smallest lane to fill it |
| --- | --- | --- |
| Merlin-neutral screenshot source contract for raw file inputs, extracted text, OCR provenance, file hashes, and evidence refs | Current screenshot-capable paths are split between generic Merlin intake records and product-specific MealScout/affiliate flows. There is no single neutral screenshot packet/schema that future lanes can target without duplicating brand logic. | Add a screenshot source packet contract under `src/merlin/governance` or `src/merlin/intake` with tests only; no runtime execution. |
| Generic screenshot/image extraction contract in Merlin core | `src/fileExtraction.ts` currently treats images as unsupported and PDFs as metadata only. Generic Merlin intake cannot truthfully claim screenshot extraction support without pre-supplied text. | Add a non-executing extraction contract/interface that records extraction status, engine provenance, and blocked reasons without wiring OCR runtime. |
| Merlin-governed bridge from screenshot evidence to generic review packet chain | Existing held-routing review chain handles routing ambiguity, but not a full screenshot-processing artifact chain from file -> extraction -> field candidate set -> operator review -> apply-eligibility artifact. | Add deterministic screenshot evidence/review packet builders only, reusing governance packet-chain patterns and existing held-routing types where possible. |
| Deterministic screenshot artifact-path policy for compact repo-safe outputs | Evidence storage policy exists, but there is no screenshot-specific artifact naming/path contract for compact manifests, review bundles, or blocked reports. Future work risks ad hoc artifact sprawl or duplicate schemas. | Add a screenshot artifact contract doc or helper for deterministic summary/report paths only. |
| Field-level correction/review contract for extracted screenshot claims | Existing review surfaces focus on routing and apply gating. There is no neutral operator contract for marking extracted fields as confirmed, disputed, missing, or replaced before downstream apply. | Add a small field-review packet schema and tests, with no UI or mutation behavior. |
| Governance linkage from screenshot review completion to merge/apply readiness | Governance packet-chain exists, but screenshot-specific lanes do not yet bind extraction evidence, validation, and approvals into a merge/apply-ready screenshot object. | Add screenshot governance packet composition that maps into `createGovernanceWorkflowPacketChain` inputs. |
| Neutral dedupe/identity contract for screenshot batches | Existing batch behavior is brand-specific and mutative. There is no Merlin-neutral contract for detecting duplicate screenshots, repeat file refs, or reused evidence across lanes. | Add a deterministic duplicate-detection contract/schema and tests before any broader batch processor lane. |

## Duplicate-Risk Warning

Do not recreate these schemas/types/contracts in a new screenshot lane unless the existing shape is clearly insufficient and the divergence is documented:

- `src/merlin/intake/intakeTypes.ts`
  - `UploadIntentFileRef`
  - `RoutingDecision`
  - `HeldRoutingReviewPacket`
  - `HeldRoutingApplyEligibility`
  - `HeldRoutingExplicitApplyApproval`
  - `HeldRoutingFinalExecutorPreview`
  - `HeldRoutingFinalExecutorDryRunPlan`
  - `HeldRoutingOperatorReviewSummary`
  - `HeldRoutingOperatorReviewPresentation`
  - `PreviewPacket`
- `src/merlin/governance/workflowPacketChain.ts`
  - governance packet IDs, fact buckets, status model, approval semantics
- `src/merlin/affiliateScreenshotFolderProcessing.ts`
  - `AffiliateScreenshotFolderProcessingReport`
  - `AffiliateScreenshotFolderPreflightReport`
  - `MerlinProfileSeedExportObject`
- `src/merlin/profileSeedRuntime.ts`
  - `MerlinExistingScreenshotSeedInput`
  - `MerlinProfileSeedResult`
- `docs/merlin/MERLIN_EVIDENCE_ARTIFACT_STORAGE_POLICY.md`
  - evidence summary vs raw artifact quarantine requirements

High duplication risk areas:

- screenshot evidence rows
- review packet status enums
- apply-approval status enums
- artifact report schemas
- OCR provenance fields
- brand routing labels

## Immediate Screenshot-Processing Readiness

`BLOCKED_BY_SMALL_GAPS`

### Why

The repository already has:

- screenshot-adjacent intake and held-review contracts
- deterministic review/apply-eligibility packet building
- folder preflight and batch screenshot processing in existing product-specific paths
- evidence storage doctrine
- focused tests around review safety and screenshot classification

But it is still blocked from a clean Merlin-neutral screenshot-processing lane because:

- generic Merlin file extraction does not support image extraction contracts
- screenshot behavior is split between generic Merlin intake and brand-specific mutative flows
- there is no neutral screenshot packet/manifest contract to prevent duplicate schemas
- there is no field-level extracted-claim review contract before downstream apply

This is not blocked by total runtime absence. It is blocked by a small set of missing neutral contracts.

## First Practical Processing Path

1. Accept screenshot/file references into existing Merlin intake or upload-intent paths without claiming extraction success.
2. Record extracted text only when supplied by an existing source or existing brand-specific preview path.
3. Route ambiguous evidence into the existing held-routing review chain.
4. Keep execution/apply disabled and preview-only until a neutral screenshot evidence/review packet contract exists.
5. Reuse existing evidence storage doctrine for any compact artifacts or review summaries.
6. Only after neutral contracts exist, open a separate runtime lane for OCR/extraction integration or screenshot batch execution.

## Recommended Next Lane

`Merlin Screenshot Packet Contracts`

### Smallest safe scope

- Create Merlin-neutral screenshot source/evidence/review packet contracts only.
- Reuse existing governance packet-chain language and existing held-routing types where possible.
- Define deterministic packet IDs, status codes, evidence refs, OCR provenance fields, blocked reasons, and approval requirements.
- Add focused tests for:
  - deterministic IDs
  - missing extraction evidence
  - missing baseline/evidence refs
  - no execution claim without evidence
  - explicit approval required before merge/apply-ready

### Explicitly out of scope for that next lane

- OCR engine implementation
- file watching
- Drive mutation
- DB persistence
- UI work
- brand-specific profile seeding changes
- autonomous execution

