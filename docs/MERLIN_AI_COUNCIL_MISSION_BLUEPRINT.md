# Merlin + AI Council Mission Blueprint

## Purpose

Define every core atom required to deliver Merlin as an action layer at speed, with accountable execution, proof-backed outcomes, and durable operating discipline.

This blueprint is implementation-oriented. It is designed to convert doctrine into shipped capability.

## Mission statement

Merlin does not replace AI.
Merlin makes constrained AI usable.

Merlin turns unreliable, chat-heavy AI interactions into controlled loops that:

- capture real input
- preserve context
- verify with evidence
- drive explicit decisions
- execute approved actions
- prove outcomes
- remember what happened

## North-star outcomes (12-month)

1. 80%+ of operator-critical workflows run through Merlin action loops, not ad-hoc chat.
2. 95%+ of external actions have linked evidence, approvals, and replay logs.
3. Median time from intake to approved action is reduced by 60%.
4. Context-loss incidents drop by 70% versus baseline manual process.
5. Unit economics improve through compression/routing so high-cost model calls are reserved for high-value steps.

## Core product atoms

These are non-optional system atoms. If any atom is weak, loop completion degrades.

### 1) Capture atom

Function:
- Ingest messy real-world input (text, screenshots, files, events, API payloads).

Requirements:
- source identity
- timestamp
- workspace/brand lane
- ingestion confidence
- immutable raw record

Proof artifact:
- intake envelope with source refs and hash.

### 2) Compress atom

Function:
- Reduce noisy input into compact, queryable state and candidate intents.

Requirements:
- deterministic extraction where possible
- model-assisted summarization where needed
- confidence + uncertainty markers
- token and cost budget logging

Proof artifact:
- compressed state snapshot + extraction evidence map.

### 3) Remember atom

Function:
- Persist continuity so workflows survive handoffs and time gaps.

Requirements:
- entity memory
- workspace memory
- action/outcome memory
- freshness windows and decay rules

Proof artifact:
- versioned memory records with provenance.

### 4) Verify atom

Function:
- Confirm facts before decisions or external actions.

Requirements:
- evidence checks (doc, API, event, policy)
- contradiction detection
- stale-data checks
- minimum evidence threshold by action risk

Proof artifact:
- verification packet with pass/fail reasons.

### 5) Decide atom

Function:
- Transform verified state into explicit decision objects.

Requirements:
- decision type
- approver level
- fallback path
- expiry/timeout
- operator-visible rationale

Proof artifact:
- decision card with policy trace.

### 6) Execute atom

Function:
- Run approved actions through the correct connector with strict controls.

Requirements:
- capability-scoped connector calls
- dry-run option
- idempotency key
- rollback/compensation strategy

Proof artifact:
- execution receipt with external reference IDs.

### 7) Prove atom

Function:
- Generate irrefutable record of what happened.

Requirements:
- replay log
- before/after state
- who approved
- when executed
- result classification

Proof artifact:
- audit bundle (decision + execution + outcome + evidence).

## AI Council atom model

The AI Council is not a brainstorming committee. It is the control system for Merlin quality, speed, and trust.

### Council charter

Mandate:
- maximize shipped loop completion rate while protecting trust and unit economics.

Authority:
- approve roadmap priorities
- approve risk thresholds
- freeze unsafe launches
- enforce evidence and policy standards

Cadence:
- daily 20-minute command review
- weekly metric/risk review
- biweekly architecture and policy review
- monthly strategy reset

### Council seats and ownership

1. Mission Owner
- final priority call
- outcome accountability

2. Product Loop Owner
- loop completion metrics
- operator workflow quality

3. Runtime/Platform Owner
- latency, reliability, scaling, cost envelope

4. Verification/Policy Owner
- evidence thresholds, safety gating, policy drift

5. Memory/Knowledge Owner
- context continuity, retrieval quality, staleness controls

6. Connector Operations Owner
- external tool integration reliability and failure handling

7. Operator Experience Owner
- UX friction, approval ergonomics, explainability quality

8. Economics Owner
- model spend, compute budget, request routing efficiency

### Council scorecard (weekly)

- loop completion rate
- median intake-to-action cycle time
- approval turnaround time
- verification failure rate by reason
- context-loss incident count
- model cost per completed loop
- external action failure rate
- rollback/compensation incidents
- operator override frequency

## Architecture required to move fast

### Control-plane principles

1. Policy before action.
2. Evidence before confidence.
3. Approval before high-risk execution.
4. Replay everywhere.
5. Deterministic first, model-assisted second.

### Service layers

1. Intake layer
- file/event ingestion
- normalization
- identity/brand lane assignment

2. Understanding layer
- extraction
- intent classification
- ambiguity tagging

3. Memory layer
- entity/workspace memory stores
- freshness and conflict resolution

4. Verification layer
- evidence checks
- policy assertions
- risk scoring

5. Decision layer
- action card generation
- approval routing

6. Execution layer
- connector adapters
- idempotent command execution

7. Proof layer
- replay, audit, outcomes ledger

### Data contracts (minimum)

- intake envelope
- compressed context packet
- verification packet
- action card
- approval record
- execution receipt
- outcome record
- replay event

## Speed operating system (90-day)

### Phase 1: Stabilize the spine (Days 1-30)

Goals:
- enforce Capture -> Compress -> Remember -> Verify -> Decide -> Execute -> Prove as explicit runtime states.

Deliverables:
- state machine visibility in operator surfaces
- hard evidence gates on risky actions
- mandatory replay linkage across all action cards

Exit criteria:
- every completed action has full proof chain
- no critical workflow bypasses policy/approval path

### Phase 2: Raise throughput (Days 31-60)

Goals:
- increase loops completed per operator without trust regression.

Deliverables:
- queue prioritization by value and risk
- better compression quality with lower model spend
- reduced manual triage on known-safe patterns

Exit criteria:
- 30%+ faster median cycle time
- no increase in severe verification misses

### Phase 3: Scale reliability and economics (Days 61-90)

Goals:
- sustain quality under higher load and constrained AI budgets.

Deliverables:
- dynamic model routing by task complexity
- fallback chains for model/connector degradation
- premium-vs-normal access parity protections via memory and compression efficiency

Exit criteria:
- stable performance at target concurrency
- cost per completed loop trending down

## What it will take (resources)

### Team core

- 1 mission owner
- 1 product loop lead
- 2 platform/runtime engineers
- 2 intake/memory/verification engineers
- 1 connector reliability engineer
- 1 operator UX engineer
- 1 data/analytics engineer
- 1 QA/automation engineer

### Essential capabilities

- strict schema governance
- deterministic parsers for common workflows
- model routing and budget controls
- replay/audit infrastructure
- approval + role model enforcement
- incident response playbooks

### Instrumentation

- per-loop latency and cost traces
- evidence completeness scoring
- context-loss telemetry
- false positive/false negative verification metrics
- operator friction signals (click depth, reversals, time-to-decision)

## Risk map and mitigations

1. Compute scarcity and spend spikes
- mitigation: model routing, cache/reuse, deterministic pre-filters, budget caps.

2. Energy and data center pressure affecting service quality
- mitigation: graceful degradation modes, prioritization tiers, retry backoff with user-visible status.

3. Normal-user friction due to chat babysitting
- mitigation: action cards, guided approvals, queue-first UX, reduced prompt dependence.

4. Context loss across sessions/tools
- mitigation: explicit memory writes at each state transition, freshness checks, conflict alerts.

5. Access gap between premium and normal AI experience
- mitigation: quality floor via policy + memory + deterministic pipelines, not just larger models.

6. Trust failures from unverifiable output
- mitigation: proof-backed execution as a release gate for production actions.

## Non-negotiables

- No magic AI claims.
- No fully autonomous positioning.
- No guaranteed-outcome claims.
- No replaces-humans messaging.
- No production action without evidence and policy checks.

## Weekly execution template

1. Monday
- Set top 3 loop bottlenecks.
- Define measurable targets.

2. Tuesday-Thursday
- Ship smallest slices that improve loop completion.
- Run replay-based validation.

3. Friday
- Score against council metrics.
- Approve, rollback, or rework.

4. End-of-week output
- one-page mission delta: what improved, what regressed, what ships next.

## Immediate next actions

1. Map current endpoints/features to the 7 atoms and mark gaps.
2. Add explicit state labels for each spine step in operator-visible payloads.
3. Enforce verification packet requirement before approval issuance.
4. Add council scorecard endpoint/report generation for weekly review.
5. Set model-cost budget thresholds and alerting by workflow.
