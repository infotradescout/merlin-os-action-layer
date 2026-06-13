# RoundTable Discord Layer

Discord is the live human interaction layer for the RoundTable system.

RoundTable defines Discord packet shape and authority rules. Merlin performs actual Discord delivery, webhook dispatch, state handling, and approval verification. Albion/AI Council governs authority, approval state, escalation rules, and human/Knight approval boundaries.

Discord is not an authority source by itself. It carries approved packets to humans; it does not create approval.

## RoundTable Contract Scope

`src/roundtableDiscord.ts` is a pure contract module in this branch.

Allowed:

- build Discord payload previews
- validate whether a packet is eligible for delivery
- preserve Merlin routing context
- preserve Albion/AI Council authority context
- expose verified approval record requirements

Forbidden:

- network calls
- webhook dispatch
- runtime environment reads
- Discord delivery state
- approval writing
- approval verification

RoundTable contract functions must not read webhook URL or token environment variables. Webhook configuration belongs to the future Merlin runtime child lane.

## Authority Gate

Discord delivery requires more than:

```text
approvalStatus = approved
approvedBy = non-empty reference
```

Those fields alone are not valid human approval because AI agents can forge them.

Valid delivery eligibility requires:

```text
approvalStatus = approved
verifiedApprovalRecordId = reference to a verified approval record
```

The verified approval record must be produced by Merlin's hardened non-LLM approval writer or an equivalent approved authority-verification path. RoundTable may reference that record; RoundTable must not produce or verify it in this branch.

## Required Message Context

Every Discord payload must include:

- Source
- Routed by
- Governed by
- Approval status
- Human review requirement
- Approved by
- Verified approval record
- Escalation path
- Source references

This keeps the boundary visible:

- RoundTable defines packet shape and routing record.
- Merlin owns delivery runtime and hardened approval verification.
- Albion/AI Council owns the authority frame.
- Human Knights retain final authority where required.

## Merlin Child Lane Required

Actual Discord delivery must be implemented in Merlin, not RoundTable.

Required child lane:

```text
Repo: merlin-os-action-layer
Branch: feature/merlin-discord-runtime-approval-writer
Goal: implement Discord webhook delivery only after a hardened non-LLM approval writer produces a verified approval record.
Required first action: inspect existing Merlin approval runtime, Discord contract payload, route/state stores, tests, and env handling before implementation.
Must preserve: no forged approval fields, no delivery without verifiedApprovalRecordId, no Discord-as-authority, no fake sent status.
```

## First Use Case

RoundTable alignment corrections, such as:

```text
Recipient: Levon / Lancelot
Issue: Project name mismatch
Current name: Autobott
Canonical Thomas project name: AutoBott
Required action: Rename Autobott to AutoBott. Do not create a duplicate.
```

This may be delivered only after Merlin verifies the approval record through the hardened approval path.
