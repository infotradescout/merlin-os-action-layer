# Plain-English Completion Report Template

This report explains a completed or blocked slice in customer-facing language while preserving auditability.

## Completion Report

```yaml
customer_completion_report_id:
created_at_local:
customer_request_packet_id:
customer_facing_status:
what_you_asked_for:
what_changed:
what_did_not_change:
what_was_verified:
what_still_needs_approval:
live_status:
evidence_summary:
next_best_action:
internal_audit_references:
  route_packet_id:
  slice_id:
  ledger_event_id:
  commit_sha:
  served_reality_result:
```

## What You Asked For

Restate the customer request in plain English.

## What Changed

Describe the completed change or documentation update. Avoid implementation jargon unless it helps the customer make a decision.

## What Did Not Change

Name non-goals and untouched areas so the customer does not assume broader work happened.

## What Was Verified

Summarize validation in plain English:

- Local tests or checks
- Review evidence
- Served-reality verification when production behavior was affected

## What Still Needs Approval, If Anything

State remaining approvals or say none.

## Live Status

Use customer-facing status language:

- Blocked
- Ready
- Needs Approval
- Live
- Verified
- Needs Fix
- Next Best Action

## Evidence Summary

Summarize the strongest evidence without hiding audit references.

## Next Best Action

State the next useful action for the customer, Merlin, Council, or Codex.

## Internal Audit References

Required fields:

- route_packet_id
- slice_id
- ledger_event_id
- commit_sha, if applicable
- served_reality_result, if applicable

If a field is not applicable, set it to `null` with a reason.
