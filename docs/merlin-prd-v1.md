# Merlin PRD (v1.1)

**MERLIN** stands for **Most Every Real Live Input Node**.

Merlin is the shared intake and search layer behind our products. It receives messy real-world inputs, organizes them into evidence, indexes them for product-scoped search, builds preview/edit packets, and only passes approved changes into the correct product.

**Operating chain:**  
Input → Evidence → Index → Search → Preview → Approval → Product Update

## 1. Product Summary
**Merlin** is the shared operating layer behind MealScout, TradeScout, HomeID, and future products.  
It does two core jobs:
- **Intake**: turns messy uploads into organized, reviewable updates.
- **Search**: makes uploaded evidence and extracted records findable and reusable across product surfaces.

Merlin supports three input modes:
- **Button-first input**
- **Upload-first input**
- **Voice-first input**

**Core flow:**  
Click action → Upload files → Merlin organizes/extracts → Merlin indexes → Preview/edit → Approve → Apply to product → Search/reuse later

## 2. Problem
Users upload unstructured files (screenshots, photos, PDFs, receipts, menus, schedules, etc.) that are ambiguous without context.  
Without intent, systems misclassify files and risk wrong updates.
Without indexing, even correctly processed uploads become hard to find and reuse later.

## 3. Product Goal
Create a central, reusable intake engine that:
- Captures user intent before processing
- Routes files safely by product/action
- Produces preview-only change packets
- Blocks silent live mutations
- Builds searchable, linked records for later retrieval and action

## 4. Non-Goals (v1)
- No auto-publish
- No direct live profile mutation
- No file deletion/cleanup
- No admin bypass of preview stage
- No autonomous apply from search results

## 5. Users
- Product users (owners/homeowners/contractors)
- Staff/admin/reps (with expanded context fields, same safety gates)

## 6. Key Principles
- Intent first, evidence second
- Index and retrieve with evidence links
- Preview required for all roles
- Least-privilege field updates by action
- Central Merlin logic, thin product adapters
- Feature-flagged rollout and kill switches
- No intent, no implementation; no preview, no implementation; no approval, no implementation

## 7. User Actions (Initial)
### MealScout
- Update Menu
- Update Schedule
- Upload Logo
- Add Photos
- Add Deal
- Upload Everything
- Search trucks, menus, schedules, deals, and source evidence

### HomeID
- Upload Everything
- Add Repair Record
- Add Warranty
- Add Receipt
- Add Appliance
- Add Inspection Report
- Add Permit
- Search home records, receipts, warranties, repairs, appliances, and documents

### TradeScout
- Add Business Card
- Add License / Insurance
- Add Job Photos
- Add Estimate
- Add Invoice
- Update Contractor Profile
- Search contractors, proofs, requests, documents, and job history

## 8. Functional Requirements (v1)
1. Create upload intent with:
   - brand, actorScope, entityType, entityId, actionId
2. Validate action against registry
3. Attach files only through valid upload intent
4. Route using action-context + file evidence
5. Hold conflicts/ambiguity for review
6. Generate preview packet only
7. Enforce:
   - `mutationAllowed: false`
   - `implementationAllowed: false`
8. Create searchable index records linked to:
   - upload intent
   - source files
   - extracted entities/fields
   - product brand/entity context

## 8.1 Search Requirements (v1.1)
1. Index records must preserve evidence linkage (`sourceFileId`, evidence refs, attribution).
2. Search must support brand/entity scoping to prevent cross-product leakage.
3. Search results must distinguish:
   - extracted/verified fields
   - candidate/unverified fields
   - deferred/needs-review fields
4. Search must never bypass preview/approval gates for live updates.

## 8.2 Voice Input Requirements (v1.1)
1. Voice input is treated as evidence and intent context, not direct authority.
2. Voice flow:
   - voice input
   - transcript normalization
   - intent/action suggestion
   - extracted changes
   - preview/edit packet
   - approval later (out of scope in this slice)
3. Voice input may create drafts and suggested actions only.
4. Voice input may not publish, mutate live records, grant authority, or bypass preview/approval.

Future endpoint/type placeholders (no apply in this slice):
- `POST /api/merlin/intake/voice`
- `POST /api/merlin/intake/voice/:voiceInputId/suggest-actions`
- `POST /api/merlin/intake/voice/:voiceInputId/confirm-action`
- `POST /api/merlin/intake/voice/:voiceInputId/preview`

`VoiceInput` fields:
- `voiceInputId`
- `userId`
- `accountId`
- `brand` optional
- `currentSurface` optional
- `actorScope`
- `entityType` optional
- `entityId` optional
- `rawTranscript`
- `normalizedTranscript`
- `detectedIntent`
- `suggestedActions`
- `extractedSignals`
- `confidence`
- `status`
- `createdAt`
- `updatedAt`

## 8.3 Affiliate Profile-Link Workflow (v1.1)
1. Affiliate uploads screenshots/files through MealScout or TradeScout adapters.
2. Merlin builds draft profile/reviewable preview packets.
3. Affiliate receives a shareable business review/claim link.
4. Outreach pitch:
   - "Here’s your profile. Come check it out and maintain it."
5. Business owner can claim, correct, approve, and maintain profile data.
6. Affiliate upload does not grant authority and does not auto-publish.

## 9. Safety Requirements
- No publish/apply execution in v1
- No silent changes to live data
- No cross-brand auto-routing
- No role bypass (admin included)
- Unknown intent/action => invalid/held

## 10. Architecture
- **Merlin Core Intake Engine** (single shared backend)
- **Merlin Index Layer** (shared evidence + record indexing)
- **Merlin Search Layer** (shared retrieval/querying)
- **Product Adapters** (MealScout/HomeID/TradeScout thin attachers)
- Product surfaces only pass context and receive preview packets

**Operating chain:**  
Merlin Intake → Merlin Index → Merlin Search → Merlin Preview → Product Apply Adapter

## 11. Feature Flags
- `MERLIN_INTAKE_ENABLED`
- `MERLIN_INTAKE_MEALSCOUT_ENABLED`
- `MERLIN_INTAKE_TRADESCOUT_ENABLED`
- `MERLIN_INTAKE_HOMEID_ENABLED`
- `MERLIN_INTAKE_ADMIN_ENABLED`
- `MERLIN_INTAKE_APPLY_ENABLED` (default false)
- `MERLIN_INTAKE_CLEANUP_ENABLED` (default false)

## 12. Success Criteria (v1 KPI)
- Every upload has valid intent context
- Files attach to correct intent
- Routing uses Merlin centrally
- Preview packet generated successfully
- Searchable index records created for processed uploads
- Product-scoped search can retrieve uploaded evidence and extracted context
- Users can input via click, upload, or voice and receive preview packets
- Zero publish execution
- Zero live mutation
- Zero file deletion

## 13. Rollout Plan
1. Hidden backend (global flag off)
2. Admin-only visibility
3. MealScout preview-only
4. Controlled apply phase (future)
5. Cleanup/archive phase (future)

## 14. Risks
- Wrong intent selection by users
- Ambiguous evidence
- Overly strict vs overly permissive routing
- Product teams trying to bypass Merlin core

## 15. Open Questions
- Minimum confidence threshold per action?
- Escalation UX for conflicts/holds?
- Retention defaults per product (especially HomeID docs)?
- Approval authority model for staff/admin vs owner?
- Search ranking strategy (exact/structured first vs hybrid semantic)?
- Index freshness + reindex policy when corrections change extracted fields?
