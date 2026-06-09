# MERLIN AI Failure-Prevention Doctrine

## Core Identity

Merlin App Builder is an operating system for AI-assisted product delivery.
Its purpose is to prevent historical AI failure modes from shipping into production.

This doctrine is mandatory before any AI-assisted UI or platform implementation.

- This is not a prompt-to-app shortcut.
- This is not model-owned governance.
- This is not screenshot imitation.
- This is the operational layer that converts intent into deterministic, validated execution.

## Core Rule Set

### 1) Complete-first implementation

Every function, file, component, route, schema, and test must be implemented as complete working units the first time.

Forbidden patterns:

- `TODO`
- `stub`
- `placeholder`
- `mock later`
- `basic example`
- `sample data`

Allowed only with:

- explicit blocker justification
- explicit human approval

### 2) Completion proof, not completion claims

No AI output is considered complete unless it is:

- built
- wired
- tested
- validated
- free of hidden placeholders

If not complete:

```text
Partial. Not production-ready.
```

### 3) File-size and maintainability limits

Hard guardrails:

- Soft warning at **400 lines**.
- Required split plan at **700 lines**.
- Blocked at **1,000+ lines** unless explicitly approved.
- Never acceptable: **12,000-line files**.

Monolithic files must be decomposed into:

- components
- services
- types
- hooks
- utils
- tests
- contracts

### 4) Screenshots as visual reference only

Screenshots and mockups are visual proof, not implementation source.

Implementation source must be:

- Design Source Packet
- Component tree
- Design tokens
- Layout rules
- State rules
- Responsive behavior
- Data dependencies
- Acceptance criteria

Do not ask AI systems to recreate a screenshot.

### 5) No random AI sprawl

Before creating files/folders/routes/terms/patterns:

- inspect existing architecture first
- reuse existing conventions
- keep names and boundaries consistent
- explain affected surfaces
- avoid duplication of established patterns

### 6) No incomplete handoff

Codex must always include:

- files changed
- what changed
- validation run
- validation result
- known risks
- unfinished items
- commit message
- next slice

### 7) No fake progress

Do not use invented evidence, invented users, invented KPI values, or invented market claims.
If required evidence is absent:

```text
Missing evidence. Decision blocked or assumption required.
```

### 8) No context loss

Every project must persist and maintain:

- Doctrine
- Flight Plan
- Decision log
- Evidence registry
- Architecture map
- Slice history
- Known blockers

### 9) Approved slices only

No broad work requests. No vague work.

Good:

```text
Implement approved Slice XX: [specific name].
Touch only listed files.
Run listed validation commands.
Return validation and risks.
```

Bad:

```text
Build the app.
Fix the UI.
Make it better.
```

### 10) Human + Council authority model

- Human authority is final.
- AI is advisory and execution-capable only.
- Albion Council performs governance review.
- Major gates require Council review before implementation.

### 11) Built-in drift prevention

Every approved slice must include:

- explicit acceptance criteria
- explicit validation commands
- deterministic test and contract coverage
- evidence trail

Failure modes must become gates or blockers in doctrine and checks.

### 12) Route first through Design Source Packet for UI

All AI/LLM handoffs for UI work must begin from structured design data.

- Component tree
- Layout grid
- Spacing scale
- Typography
- Color tokens
- Content hierarchy
- Interaction states
- Responsive rules
- Data dependencies
- Acceptance criteria

### 13) Mandatory contract checks

The following requirements must be contract-checked in automation:

- doctrine file exists
- doctrine contains required core rules
- screen-level packet contract language is present
- evidence/gating language is present
- no forbidden progress claims in scope definitions

## Doctrine enforcement checklist

Before each slice:

- Confirm this doctrine is current and signed.
- Confirm Flight Plan and active slice scope.
- Confirm no unknown evidence is being assumed as fact.
- Confirm required UI Design Source Packet fields are present.
- Confirm file decomposition and size constraints are met.
- Confirm Council and human checkpoints are observed.

After each slice:

- Update decision log and blockers.
- Archive evidence and validation output.
- Prepare the next approved slice with measurable next step.

## Default operating commandments

```text
No drift. No missed steps. No fake data. No premature code. No model-owned authority.
```
