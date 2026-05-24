# Merlin OR v0.6 Policy Engine

## Status

Implemented as deterministic in-memory policy foundations.

## What works

- Added `src/policy.ts`.
- Added `evaluatePolicy(input)` returning:
  - `allowed`
  - `level`
  - `requires_approval`
  - `blocked`
  - `reason`
  - `brand_lane`
  - `action_type`
- Added default levels:
  - view_context → `read_only`
  - create_internal_note → `organize_internal`
  - create_task → `organize_internal`
  - draft_message → `draft_only`
  - suggest_follow_up → `draft_only`
  - update_internal_status → `approval_required`
  - send_external_message → `approval_required`
  - approve_verification → `approval_required`
  - change_payment_state → `blocked_high_risk`
  - delete_record → `blocked_high_risk`
- Added deterministic overrides:
  - payment actions are blocked as high risk
  - destructive actions are blocked
  - unknown actions are blocked by default
  - external sends require approval
- Added reset hook: `resetPolicyForTest()`.
- Added tests at `tests/policy.test.ts` for read-only, draft-only, approval-required, blocked, and unknown action behavior.

## Supported lanes

- tradescout
- mealscout
- merlin
- lisa
- continuum
- marketfilter
- system

## Known limitations

- In-memory only.
- No endpoint integration yet.
- No auth, voice, or action executor wiring.
- No audit persistence.

## Runbook

```bash
npm run check
npm run test
npx tsx --test tests/policy.test.ts
npx tsx --test tests/outcomes.test.ts
npx tsx --test tests/api-v0.test.ts
npx tsx --test tests/entity-resolution.test.ts
npx tsx --test tests/source-registry.test.ts tests/freshness.test.ts
```

## Next milestone

v0.7 — Recommendation records connect to policy + outcomes.
