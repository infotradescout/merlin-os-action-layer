# RoundTable Discord Layer

Discord is the live human layer for the RoundTable system.

It is not an authority source by itself. Discord carries messages to humans, while:

- RoundTable routes decisions and packets.
- Merlin supplies execution, intake, search, storage, and approved action context.
- Albion/AI Council governs authority, approval state, and escalation rules.
- Human Knights retain final authority where required.

## Current Runtime Contract

`src/roundtableDiscord.ts` provides an environment-gated Discord webhook dispatcher.

Required environment:

```text
ROUNDTABLE_DISCORD_WEBHOOK_URL
```

Optional environment:

```text
ROUNDTABLE_DISCORD_WEBHOOK_TOKEN
```

If no webhook is configured, dispatch fails with:

```text
roundtable_discord_webhook_not_configured
```

The system must not simulate or mark Discord delivery as sent.

## Authority Gate

Discord dispatch requires:

```text
approvalStatus = approved
approvedBy = non-empty human/system approval reference
```

Unapproved packets are blocked with:

```text
discord_dispatch_requires_approved_packet
```

Draft and needs-review messages may still be previewed as payloads, but they are not posted.

## Required Message Context

Every Discord message must include:

- Source
- Routed by
- Governed by
- Approval status
- Human review requirement
- Approved by
- Escalation path
- Source references

This keeps Merlin and Albion/AI Council working together: Merlin provides operational context, and Albion carries the authority frame.

## First Use Case

RoundTable alignment corrections, such as:

```text
Recipient: Levon / Lancelot
Issue: Project name mismatch
Current name: Autobott
Canonical Thomas project name: AutoBott
Required action: Rename Autobott to AutoBott. Do not create a duplicate.
```

This should be posted only after the correction packet is approved for dispatch.
