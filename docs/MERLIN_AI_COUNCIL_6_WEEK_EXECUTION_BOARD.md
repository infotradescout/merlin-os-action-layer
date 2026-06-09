# Merlin OS Action Layer / 6-Week Execution Board

## Purpose

Convert the accepted mission blueprint into operating pressure with fixed weekly deliverables, owner lanes, pass/fail gates, and KPI accountability.

This board is execution control, not additional doctrine.

## Scope anchor

Near-term wedge:

AI 1.0 hits a scaling ceiling.
Merlin makes constrained AI usable through action loops, memory, proof, and governance.

## Owner lanes

1. Mission Owner
- Priority arbitration, escalation, and weekly ship/no-ship decision.

2. Product Loop Owner
- Loop design quality, action-card flow, and operator outcome alignment.

3. Runtime/Platform Owner
- Reliability, latency, runtime state integrity, and deployment readiness.

4. Verification/Policy Owner
- Evidence thresholds, policy gates, approval rules, and risk controls.

5. Memory/Knowledge Owner
- Context persistence, retrieval quality, freshness/decay behavior.

6. Connector Operations Owner
- Connector reliability, idempotency, failure handling, replay link integrity.

7. Operator Experience Owner
- Queue UX friction, decision ergonomics, clarity of evidence and status.

8. Economics Owner
- Model routing policy, budget caps, cost/loop trend, utilization efficiency.

## KPI scoreboard (weekly)

Track all KPIs every week. Red requires corrective action before expanding scope.

Authoritative KPI data-source contract:

- `docs/MERLIN_WEEKLY_SCOREBOARD_DATA_CONTRACT.md`

### KPI definitions

- loop completion rate: completed loops / started loops.
- intake-to-action cycle time: median elapsed time from capture to approved execution.
- approval turnaround time: median elapsed time from decision card issuance to approval outcome.
- verification failure rate: failed verification packets / total verification attempts.
- context-loss incidents: count of incidents requiring manual reconstruction.
- model cost per completed loop: total model cost / completed loops.
- external action failure rate: failed connector executions / total execution attempts.
- operator override rate: overrides / total decisions.

### KPI target bands (6-week control window)

- loop completion rate: week 1 baseline, week 6 improve by >= 20%.
- intake-to-action cycle time: week 6 reduce by >= 25% from baseline.
- approval turnaround time: week 6 reduce by >= 20% from baseline.
- verification failure rate: week 6 reduce by >= 15% from baseline.
- context-loss incidents: week 6 reduce by >= 40% from baseline.
- model cost per completed loop: week 6 reduce by >= 15% from baseline.
- external action failure rate: week 6 <= week 1 baseline and trending down.
- operator override rate: week 6 reduce by >= 10% from baseline.

## Pass/fail gate rules

Weekly gate status is pass only if all required conditions are met.

Global fail triggers:

- any high-risk action executed without verification packet and approval linkage
- replay chain broken for any production action
- external action failure rate worsens for 2 consecutive weeks without mitigation
- context-loss incidents increase for 2 consecutive weeks without mitigation

If a weekly gate fails:

1. Freeze scope expansion for next week.
2. Assign owner-level corrective plan within 24 hours.
3. Re-run the failed gate criteria before unlocking new work.

## 6-week board

## Week 1 - Baseline and instrumentation lock

Primary objective:
- establish KPI baselines and enforce observability for every loop step.

Deliverables:
- Mission Owner: approves baseline measurement protocol and weekly review ceremony.
- Product Loop Owner: publishes current loop map for Capture -> Compress -> Remember -> Verify -> Decide -> Execute -> Prove.
- Runtime/Platform Owner: ensures state-transition telemetry emitted at each loop stage.
- Verification/Policy Owner: defines verification packet minimum schema and required fields.
- Memory/Knowledge Owner: defines context-loss incident taxonomy and logging rules.
- Connector Operations Owner: adds execution receipt completeness checks in runtime logging.
- Operator Experience Owner: captures baseline friction points in current operator flows.
- Economics Owner: establishes model-cost baseline per completed loop and per workflow.

Week 1 pass gate:
- all 8 KPI baselines are available and reviewable.
- 100% of production actions include traceable loop stage telemetry.
- verification packet schema is approved and documented.

## Week 2 - Verification and approval hard gates

Primary objective:
- block unsafe actions by making verification and approval mandatory gates.

Deliverables:
- Mission Owner: signs off release blocker policy for verification/approval bypass.
- Product Loop Owner: updates action-card lifecycle to require verification status before approval issuance.
- Runtime/Platform Owner: enforces runtime hard-stop when verification packet is missing.
- Verification/Policy Owner: implements risk-tier evidence thresholds and pass/fail reasons.
- Memory/Knowledge Owner: records decision rationale and evidence references into memory ledger.
- Connector Operations Owner: enforces idempotency key requirement for every execution call.
- Operator Experience Owner: exposes clear verification status and missing-evidence reasons in operator views.
- Economics Owner: reports cost impact of new gating and proposes optimization opportunities.

Week 2 pass gate:
- zero production executions without verification packet.
- zero production executions without approval linkage for gated risk tiers.
- operator can view verification pass/fail reason for every gated action.

## Week 3 - Memory continuity and context-loss reduction

Primary objective:
- reduce rework by strengthening memory continuity and freshness control.

Deliverables:
- Mission Owner: approves context continuity standard for all priority workflows.
- Product Loop Owner: requires memory write checkpoints at end of Compress, Verify, and Prove stages.
- Runtime/Platform Owner: adds freshness expiration checks to prevent stale decision execution.
- Verification/Policy Owner: adds contradiction checks against existing memory before approval routing.
- Memory/Knowledge Owner: ships conflict-resolution rules and stale-memory flags.
- Connector Operations Owner: links connector results back to entity/workspace memory references.
- Operator Experience Owner: adds operator-visible context lineage summary for decision cards.
- Economics Owner: quantifies token savings from memory reuse vs repeated full-context prompts.

Week 3 pass gate:
- context-loss incidents trend down versus week 1 baseline.
- stale-memory execution attempts are blocked and logged.
- decision cards show context lineage source references.

## Week 4 - Throughput and queue control

Primary objective:
- increase completed loops per operator without trust regression.

Deliverables:
- Mission Owner: sets throughput target with explicit no-regression quality constraints.
- Product Loop Owner: defines queue priority model (value, risk, freshness, dependency).
- Runtime/Platform Owner: implements queue SLA timers and breach alerts.
- Verification/Policy Owner: tunes policy checks for low-risk deterministic fast lanes.
- Memory/Knowledge Owner: pre-computes compact context packets for top-volume workflows.
- Connector Operations Owner: adds retry/backoff policy and failure classification to connector lane.
- Operator Experience Owner: streamlines approval interactions for repeat-safe patterns.
- Economics Owner: validates throughput gains do not increase model cost per completed loop.

Week 4 pass gate:
- loop completion rate improves from baseline.
- intake-to-action cycle time improves from baseline.
- verification failure rate does not regress.

## Week 5 - Reliability and economics pressure test

Primary objective:
- prove stable operation under constrained AI and connector variability.

Deliverables:
- Mission Owner: approves pressure-test scenarios and success criteria.
- Product Loop Owner: identifies critical-path workflows for stress validation.
- Runtime/Platform Owner: runs controlled load tests on action-loop transitions.
- Verification/Policy Owner: validates policy behavior under degraded signal quality.
- Memory/Knowledge Owner: validates memory retrieval quality under higher concurrency.
- Connector Operations Owner: simulates connector degradation and validates graceful fallbacks.
- Operator Experience Owner: validates clarity of degraded-mode messaging and operator controls.
- Economics Owner: enforces budget cap alarms and dynamic model routing thresholds.

Week 5 pass gate:
- external action failure rate remains stable or improves.
- model cost per completed loop trends down or flat with higher load.
- degraded mode preserves approval and proof requirements.

## Week 6 - Council sign-off and scale-ready release gate

Primary objective:
- graduate from sprint execution to recurring operating rhythm with hard governance.

Deliverables:
- Mission Owner: runs final cross-lane review and determines release gate outcome.
- Product Loop Owner: confirms loop spec and acceptance criteria are versioned.
- Runtime/Platform Owner: confirms production readiness checklist complete.
- Verification/Policy Owner: confirms all high-risk actions remain policy-gated.
- Memory/Knowledge Owner: confirms memory continuity metrics meet threshold.
- Connector Operations Owner: confirms connector reliability and fallback playbooks active.
- Operator Experience Owner: confirms operator override pathways are deliberate and auditable.
- Economics Owner: confirms unit economics trend and budget controls stable.

Week 6 pass gate:
- at least 6 of 8 KPIs meet or exceed 6-week target bands.
- no global fail trigger active.
- AI Council signs release readiness decision with remediation list for remaining gaps.

## Weekly operating cadence (fixed)

Monday:
- KPI review, risk review, gate carry-forward decisions.

Tuesday to Thursday:
- deliverables execution and midweek evidence check.

Friday:
- pass/fail decision, remediation assignment, and next-week scope lock.

## Scoreboard template

Use this structure each week:

- week: W1 to W6
- loop completion rate: value, delta vs baseline, status green/yellow/red
- intake-to-action cycle time: value, delta, status
- approval turnaround time: value, delta, status
- verification failure rate: value, delta, status
- context-loss incidents: count, delta, status
- model cost per completed loop: value, delta, status
- external action failure rate: value, delta, status
- operator override rate: value, delta, status
- gate decision: pass/fail
- blocker list: open/closed with owner lane

## Non-negotiables

- pre-code Motive/Intent/Expectation brief is required before any code slice starts
- no new UI surfaces in this slice
- no shell architecture additions in this slice
- no Stripe/payment changes in this slice
- no guaranteed outcome claims
- no replacement of blueprint with vague strategy language
