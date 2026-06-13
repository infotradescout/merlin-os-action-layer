# RoundTable Discord Runtime Bridge

Discord is the live human layer for the RoundTable system.

RoundTable owns packet doctrine and the packet payload contract. Merlin owns live delivery, Discord interaction verification, delivery attempt evidence, and verified approval records. Albion/AI Council governs authority rules.

## Boundary

Merlin must not treat text fields such as `approvalStatus`, `approvedBy`, or AI-written summaries as authority.

Merlin may:

- Deliver a RoundTable packet to Discord through a configured webhook.
- Record delivery attempts.
- Verify Discord interaction signatures.
- Verify allowlisted user, role, guild, and channel.
- Verify packet ID and approved action scope.
- Write a `verifiedApprovalRecord`.
- Return evidence packets back to RoundTable.

Merlin must not:

- Auto-merge.
- Auto-deploy.
- Auto-send external messages beyond the configured Discord packet delivery.
- Auto-apply product changes.
- Treat AI-generated approval text as authorization.

## Environment

Webhook delivery:

```text
ROUNDTABLE_DISCORD_WEBHOOK_URL
ROUNDTABLE_DISCORD_WEBHOOK_TOKEN optional
```

Interaction verification:

```text
ROUNDTABLE_DISCORD_PUBLIC_KEY
ROUNDTABLE_DISCORD_APPROVER_USER_IDS
ROUNDTABLE_DISCORD_GUILD_ID
ROUNDTABLE_DISCORD_APPROVAL_CHANNEL_IDS
ROUNDTABLE_DISCORD_APPROVER_ROLE_IDS optional
```

If no webhook is configured, delivery fails safely with:

```text
roundtable_discord_webhook_not_configured
```

The system must not simulate or mark Discord delivery as sent.

## Packet Delivery

`dispatchRoundTableDiscordPacket` stores the RoundTable packet, builds a Discord webhook payload, attempts delivery only through configured webhook transport, records the attempt, and returns a RoundTable evidence packet.

Delivery evidence includes:

- Packet ID
- Delivery attempt ID
- Webhook configured check
- Sent/failed outcome
- Payload preview
- `noExecutionPerformed: true`

Delivery does not create approval authority.

## Verified Approval Writer

`verifyAndWriteDiscordApproval` requires all checks:

- Valid Discord Ed25519 interaction signature.
- Discord user ID is allowlisted.
- Discord guild matches configured guild.
- Discord channel is allowlisted.
- Discord role matches allowlisted role when roles are configured.
- Interaction custom ID contains a known packet ID.
- Requested action scope is present in that packet's `approvedActionScopes`.

Only after those checks pass does Merlin write a `verifiedApprovalRecord`.

The verified record is evidence for RoundTable. It does not execute the approved action.

## HTTP Runtime Routes

```text
POST /api/roundtable/discord/dispatch
POST /api/roundtable/discord/interactions
```

The interactions route reads the raw request body so Discord signature verification uses the exact signed bytes.

## First Use Case

RoundTable alignment correction:

```text
Recipient: Levon / Lancelot
Issue: Project name mismatch
Current name: Autobott
Canonical Thomas project name: AutoBott
Approved action scope: project.rename:Autobott->AutoBott
Required action: Rename Autobott to AutoBott. Do not create a duplicate.
```
