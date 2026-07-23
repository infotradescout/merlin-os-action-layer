# Ledger Schema

The Ledger is the canonical audit trail for AI-native app-building governance.

The Ledger begins as repo-native markdown records with strict YAML frontmatter. It may later be mirrored into JSONL or a database, but the repository Ledger is the canonical source until a future migration is explicitly approved.

Ledger records must be human-readable, Git-diffable, and machine-parseable later.

## Canonical Record Format

Each Ledger event must be a markdown file with YAML frontmatter followed by a short human-readable summary.

```markdown
---
ledger_event_id:
timestamp_local:
brand_lane:
product_surface:
customer_request_packet_id:
customer_completion_report_id:
customer_visible_status:
route_packet_id:
slice_id:
executed_by:
orchestrated_by:
approved_by:
adversarial_review_by:
tests_run:
  - command:
    result:
    run_by:
evidence_refs:
  - 
production_smoke_required:
production_smoke_by:
commit_sha:
status:
failure_reason:
next_route_recommendation:
ledger_recorded_by:
---

# Ledger Event

## Summary

## Evidence

## Actor Attribution Notes

## Next Route Recommendation
```

## Required Fields

- `ledger_event_id`
- `timestamp_local`
- `brand_lane`
- `product_surface`
- `customer_request_packet_id`
- `customer_completion_report_id`
- `customer_visible_status`
- `route_packet_id`
- `slice_id`
- `executed_by`
- `orchestrated_by`
- `approved_by`
- `adversarial_review_by`
- `tests_run`
- `evidence_refs`
- `production_smoke_required`
- `production_smoke_by`
- `commit_sha`
- `status`
- `failure_reason`
- `next_route_recommendation`

`ledger_recorded_by` is also required by the actor-attribution invariant because ledger recording must be attributable.

## Actor Attribution

Every Ledger event must include actor attribution.

Actor attribution must cover:

- Execution
- Orchestration
- Approval
- Adversarial review
- Testing
- Production smoke
- Ledger recording

If an actor is not applicable, the value must be explicitly set to `null` with a reason.

Recommended null shape:

```yaml
approved_by:
  actor_id: null
  reason: "No approval gate applied to this internal docs-only slice."
```

Recommended actor shape:

```yaml
executed_by:
  actor_id:
  actor_type:
  role:
```

Testing attribution is recorded inside each `tests_run` entry:

```yaml
tests_run:
  - command:
    result:
    run_by:
      actor_id:
      actor_type:
      role:
```

## Status Values

Use one of:

- `complete`
- `blocked`
- `failed`
- `superseded`

No slice may be marked complete without a Ledger event.

No production-facing slice may be marked complete without a served-reality result or explicit blocked status.

## Customer Request Linkage

If a slice began from a customer request, the Ledger event must reference the `customer_request_packet_id`.

If the slice is internal-only:

```yaml
customer_request_packet_id:
  value: null
  reason: "Internal-only governance slice; no customer request packet generated it."
```

## Production Smoke Linkage

If production smoke is required, `production_smoke_required` must be `true` and `production_smoke_by` must identify the actor or explicit blocker.

If production smoke is not required, `production_smoke_required` must be `false` and the record must state why served-reality verification does not apply.

## Required Invariants

- Every Ledger event must include actor attribution.
- Actor attribution must cover execution, orchestration, approval, adversarial review, testing, production smoke, and ledger recording.
- If an actor is not applicable, the value must be explicitly set to null with a reason.
- No slice may be marked complete without a Ledger event.
- No production-facing slice may be marked complete without a served-reality result or explicit blocked status.
- The Ledger must be human-readable, Git-diffable, and machine-parseable later.
- If a slice began from a customer request, the Ledger event must reference the customer_request_packet_id.
