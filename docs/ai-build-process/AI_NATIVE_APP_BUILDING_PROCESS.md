# AI-Native App Building Process

## Summary

Merlin uses AI-native build governance to convert customer intent into bounded, verified software changes without relying on loose project management, memory in chat, or model confidence.

This process defines three operating layers:

1. AI-Native Build Governance
2. Served-Reality Verification
3. Customer Operating Layer

The process is designed for AI-assisted software building by non-developer customers, founders, operators, and very small teams. It keeps business language simple while preserving auditability through route packets, slice IDs, evidence, commits, served-reality results, and ledger events.

## Why Legacy App Building Fails With AI

Legacy app building assumes a stable team can hold context across meetings, tickets, code reviews, deployments, and customer feedback. AI-assisted building changes that risk profile.

Common failure modes:

- Model suggestions outrun doctrine.
- Broad requests become unbounded implementation.
- Local tests are treated as production truth.
- UI or product changes ship without served-reality verification.
- Customer approvals are detached from the code and ledger trail.
- Brand lanes, product surfaces, and personas blur together.
- Cleanup and opportunistic refactors enter slices without authorization.
- Teams declare success before evidence is captured.
- State mutations become untraceable because actor attribution is missing.

Merlin replaces this with system governance: intent is routed, scoped, executed, verified, committed, served, and recorded.

## Core Principle

Doctrine beats model suggestion.

AI may draft, review, reason, and implement inside an approved slice. AI may not self-authorize, broaden scope, invent evidence, hide audit detail, skip served-reality checks, or override the governance chain.

## Canonical Flow

Intent
→ Doctrine
→ Route
→ Slice
→ Evidence
→ Decision
→ Commit
→ Serve
→ Ledger

## Role Definitions

### User / Founder Authority

The User or Founder Authority owns business intent, final approval, risk acceptance, and customer-facing priorities.

They may approve goals, reject scope, accept risk, request changes, and decide when a customer-visible outcome is acceptable.

### Merlin (Orchestrator / Final Arbiter)

Merlin owns orchestration, doctrine alignment, routing, gate enforcement, evidence interpretation, served-reality requirements, and final arbitration before a slice is declared complete.

Merlin translates customer language into internal governance language and translates verified outcomes back into customer-facing language.

### AI Council

The AI Council reviews proposals, assumptions, risks, doctrine fit, customer impact, and sequencing. The Council may recommend, object, or request evidence.

The AI Council does not execute code and does not override User / Founder Authority.

### Objector (Adversarial Reviewer)

The Objector challenges the slice before completion. The Objector looks for hidden scope, stale production behavior, skipped evidence, unsafe authority, weak tests, brand-lane bleed, and customer-language ambiguity.

### Codex (Implementer)

Codex executes approved route packets and bounded slices. Codex may inspect files, edit files, run validation, fix in-scope failures, commit changes when instructed, and report results.

Codex may not broaden scope, invent product data, create unrelated features, skip validation, or self-authorize runtime behavior.

### Tests

Tests provide local verification that required behavior and contracts hold in the repository. Tests are necessary but not sufficient for production-facing changes.

### Production Smoke

Production Smoke verifies served reality. It checks the deployed or served environment for expected routes, visible copy, action paths, forbidden stale content, build markers, telemetry, and cache/deploy correctness.

### Ledger

The Ledger is the canonical audit trail. It records slice execution, gate approvals, actor attribution, evidence references, commit SHA, served-reality result, status, failure reason, and next route recommendation.

## Doctrine Gate

The Doctrine Gate confirms the request is allowed by current Merlin doctrine and product rules.

Minimum checks:

- The request maps to a known brand lane or explicitly creates a new approved lane.
- The request does not conflict with existing safety, audit, privacy, or authority doctrine.
- Required non-goals are stated.
- Forbidden stale content or forbidden behavior is named where applicable.
- Customer-facing language does not hide internal auditability.

If doctrine is missing or conflicts with the request, the slice is blocked until the User / Founder Authority approves the doctrine update.

## Council Decision Gate

The Council Decision Gate applies review before execution when risk, ambiguity, customer impact, production behavior, authority, data mutation, or cross-brand implications exist.

The gate must record:

- Decision summary
- Objector concerns
- Evidence required before execution
- Approval actor
- Conditions or stop points

Council approval is advisory unless the governing doctrine makes it mandatory for the slice type. Human authority remains final.

## Route Packet Gate

The Route Packet Gate converts intent into one bounded internal route packet.

One route packet equals one bounded behavior slice.

Every route packet must include:

- Brand
- Product surface
- User/persona
- Desired outcome
- Primary KPI
- Doctrine references
- customer_request_packet_id or explicit null with reason
- Required behavior
- Required tests
- Required production smoke when production behavior is affected
- Non-goals
- Stop conditions
- Commit instruction
- Final report format

No Codex execution begins without an approved route packet.

## Slice Execution Gate

The Slice Execution Gate authorizes Codex to execute exactly the approved slice.

Rules:

- No unrelated cleanup inside a slice.
- No extra product features.
- No invented customer data.
- No runtime placeholders.
- No implementation outside listed or clearly discovered in-scope files.
- Stop if doctrine, tests, served reality, or evidence requirements cannot be satisfied.

Codex must report blockers rather than improvise around them.

## Evidence Gate

The Evidence Gate requires proof before a success claim.

Evidence may include:

- Tests run and results
- Contract checks
- Screenshots or browser checks
- HTTP responses
- Build output
- Served-reality smoke results
- Commit SHA
- Relevant file references

Evidence must be captured before declaring success.

## Commit Gate

The Commit Gate confirms the repository state is intentional.

Minimum checks:

- Files changed match the slice.
- Runtime files are unchanged for docs-only slices.
- Tests or fallback validation ran.
- Commit message matches the route packet.
- No unrelated cleanup is included.
- Final git status is known.

Commit SHA becomes part of the audit trail when applicable.

## Served-Reality Gate

The Served-Reality Gate verifies production or served behavior when production behavior is affected.

No feature is complete until served reality is verified when production behavior is affected.

Local tests are necessary but not sufficient.

The gate must check:

- Expected commit/build marker
- Domains/routes
- HTTP status expectations
- Required visible copy
- Forbidden stale copy
- Required action path
- Required telemetry/evidence
- Cache or stale deploy failure handling

A production-facing slice cannot be marked complete until served reality is verified or explicitly marked blocked with a failure reason.

## Customer Operating Layer

Merlin uses two languages.

### A. Internal Governance Language

- Doctrine
- Route Packet
- Slice
- Evidence Gate
- Served-Reality Gate
- Ledger Event
- Actor Attribution
- Commit SHA
- Production Smoke

### B. Customer-Facing Language

- Goal
- Blocked
- Ready
- Needs Approval
- Live
- Verified
- Needs Fix
- Next Best Action

Customer-facing language must simplify without hiding auditability.

Customer translation flow:

Customer business intent
→ Merlin intake
→ business outcome map
→ doctrine check
→ customer approval card
→ internal route packet
→ Codex slice
→ evidence gate
→ served-reality gate
→ plain-English completion report
→ ledger event

The customer should see plain English. The system must still retain traceability to route_packet_id, slice_id, ledger_event_id, commit_sha when applicable, and served_reality_result when production behavior is affected.

## Ledger Gate

The Ledger Gate records the slice outcome in a human-readable, Git-diffable, machine-parseable repo-native record.

Strict Actor Attribution is mandatory. The Ledger must explicitly record the actor ID responsible for every executed slice and gate approval to prevent untraceable state mutations.

Actor attribution must cover:

- Execution
- Orchestration
- Approval
- Adversarial review
- Testing
- Production smoke
- Ledger recording

If an actor is not applicable, the value must be explicitly set to null with a reason.

No slice may be marked complete without a Ledger event.

## Non-Goals

This process does not:

- Replace human authority.
- Let AI self-authorize execution.
- Treat model output as evidence.
- Permit invented product-specific customer data.
- Permit broad cleanup inside a bounded slice.
- Replace production verification with local tests for production-facing behavior.
- Hide audit references from internal records.
- Require customer-facing reports to expose technical detail beyond what is useful to the customer.

## Required Invariants

- No feature is complete until served reality is verified when production behavior is affected.
- Local tests are necessary but not sufficient.
- Doctrine beats model suggestion.
- Brand lanes must remain isolated.
- One route packet equals one bounded behavior slice.
- No unrelated cleanup inside a slice.
- Every slice must declare non-goals.
- Every production-facing change must define forbidden stale content or forbidden behavior where applicable.
- Evidence must be captured before declaring success.
- Strict Actor Attribution: The Ledger must explicitly record the actor ID responsible for every executed slice and gate approval to prevent untraceable state mutations.
- The customer-facing layer must simplify language without hiding auditability.
- Every customer-facing approval, completion report, or status update must be traceable to route_packet_id, slice_id, ledger_event_id, commit_sha when applicable, and served_reality_result when production behavior is affected.
