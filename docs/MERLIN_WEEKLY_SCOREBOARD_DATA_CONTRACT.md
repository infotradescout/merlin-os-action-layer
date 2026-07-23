# Merlin Weekly Scoreboard Data Contract

## Purpose

Define one authoritative runtime query/output path for each KPI in the 6-week execution board.

Authoritative output endpoints:

- `GET /api/merlin/scoreboard/contract`
- `GET /api/merlin/scoreboard/weekly`

Contract version: `v1`

## Immutable weekly snapshot artifact

Weekly council review should use saved evidence, not transient API output. Generate the read-only snapshot artifact with:

```bash
npx tsx scripts/merlin-weekly-scoreboard-snapshot.ts --week-start <ISO> --week-end <ISO>
```

The process writes:

- `artifacts/merlin-scoreboard/YYYY-WW/weekly-scoreboard.json`

The artifact uses the same contract shape as `GET /api/merlin/scoreboard/weekly` and adds:

- `generated_at`
- `council_decision: null`
- `notes: ""`

Unavailable KPI metrics must remain present with their `missing_reason`; the snapshot process must not invent KPI values.

## Immutable council decision record

Create a companion decision artifact after review using the same week evidence:

```bash
npx tsx scripts/merlin-council-decision-record.ts \
  --snapshot-path artifacts/merlin-scoreboard/YYYY-WW/weekly-scoreboard.json \
  --decision pass|fail|deferred \
  --decided-by "<operator>" \
  --rationale "<decision rationale>" \
  --blockers "<comma-separated blockers>"
```

The process writes:

- `artifacts/merlin-scoreboard/YYYY-WW/council-decision.json`

Required fields:

- `generated_at`
- `weekKey`
- `snapshotPath`
- `decision`
- `rationale`
- `blockers`
- `next_actions`
- `owner_lane_decisions`
- `decided_by`
- `mutationAllowed: false`

The command validates that `snapshotPath` exists before writing so the KPI evidence file is never mutated by the decision process.

## Weekly output shape

Each KPI is emitted at:

- `metrics.<kpi_id>`

Each metric object shape:

- `kpi_id`
- `owner_lane`
- `value` (`number | null`)
- `unit` (`ratio | hours | count | usd`)
- `numerator` (`number | null`)
- `denominator` (`number | null`)
- `sample_size` (`number`)
- `status` (`available | unavailable`)
- `missing_reason` (`string | null`)

## KPI definitions

### 1) loop_completion_rate

- owner lane: Product Loop Owner
- source table/file/event stream: `sqlite:merlin_action_cards`
- formula: `completed_loops / started_loops`
- required fields: `id`, `status`, `created_at`
- missing-data behavior: if `started_loops = 0`, emit unavailable (`no_started_loops`)
- authoritative query/output path: `GET /api/merlin/scoreboard/weekly -> metrics.loop_completion_rate`
- implementation status: implemented

### 2) intake_to_action_cycle_time

- owner lane: Runtime/Platform Owner
- source table/file/event stream: `sqlite:merlin_intake_items`, `sqlite:merlin_intake_action_card_links`, `sqlite:merlin_outcomes`
- formula: median `hours(outcome.observed_at - intake.created_at)` for linked intake->action->outcome samples
- required fields: intake id/created_at, link action_card_id, outcome action_card_id/observed_at
- missing-data behavior: if no linked samples, emit unavailable (`no_linked_samples`)
- authoritative query/output path: `GET /api/merlin/scoreboard/weekly -> metrics.intake_to_action_cycle_time`
- implementation status: implemented

### 3) approval_turnaround_time

- owner lane: Verification/Policy Owner
- source table/file/event stream: `sqlite:merlin_approvals`
- formula: median `hours(updated_at - created_at)` for terminal approvals
- required fields: `approval_status`, `created_at`, `updated_at`
- missing-data behavior: if no terminal approvals, emit unavailable (`no_terminal_approvals`)
- authoritative query/output path: `GET /api/merlin/scoreboard/weekly -> metrics.approval_turnaround_time`
- implementation status: implemented

### 4) verification_failure_rate

- owner lane: Verification/Policy Owner
- source table/file/event stream: `planned:merlin_verification_packets`
- formula: `failed_verification_packets / total_verification_packets`
- required fields: verification packet id/status/created_at
- missing-data behavior: emit unavailable (`source_not_implemented`)
- authoritative query/output path: `GET /api/merlin/scoreboard/weekly -> metrics.verification_failure_rate`
- implementation status: not implemented

### 5) context_loss_incidents

- owner lane: Memory/Knowledge Owner
- source table/file/event stream: `planned:context_loss_incident_events`
- formula: `count(context_loss_incident)` in week window
- required fields: incident id/entity id/reason/created_at
- missing-data behavior: emit unavailable (`source_not_implemented`)
- authoritative query/output path: `GET /api/merlin/scoreboard/weekly -> metrics.context_loss_incidents`
- implementation status: not implemented

### 6) model_cost_per_completed_loop

- owner lane: Economics Owner
- source table/file/event stream: `planned:model_usage_cost_ledger`, `sqlite:merlin_action_cards`
- formula: `sum(model_cost_usd) / completed_loops`
- required fields: model cost entries + loop linkage + timestamps
- missing-data behavior: emit unavailable (`source_not_implemented`)
- authoritative query/output path: `GET /api/merlin/scoreboard/weekly -> metrics.model_cost_per_completed_loop`
- implementation status: not implemented

### 7) external_action_failure_rate

- owner lane: Connector Operations Owner
- source table/file/event stream: `planned:merlin_external_execution_receipts`
- formula: `failed_external_actions / attempted_external_actions`
- required fields: execution id/status/connector/created_at
- missing-data behavior: emit unavailable (`source_not_implemented`)
- authoritative query/output path: `GET /api/merlin/scoreboard/weekly -> metrics.external_action_failure_rate`
- implementation status: not implemented

### 8) operator_override_rate

- owner lane: Operator Experience Owner
- source table/file/event stream: `planned:operator_override_decision_events`, `sqlite:merlin_approvals`
- formula: `operator_overrides / total_decisions`
- required fields: decision id/is_override/created_at
- missing-data behavior: emit unavailable (`source_not_implemented`)
- authoritative query/output path: `GET /api/merlin/scoreboard/weekly -> metrics.operator_override_rate`
- implementation status: not implemented
