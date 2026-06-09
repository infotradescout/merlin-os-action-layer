# Merlin OS Action Layer

Controlled action layer for Merlin OS: brand-safe execution across Google Drive, Gmail, Calendar, Stripe, Canva, MealScout, TradeScout, and LISA.

## Purpose

The Merlin OS Action Layer turns trusted business intent into safe, auditable actions.

## AI 2.0 doctrine

Merlin is not AI hype.
Merlin is what comes after AI hype fails.

Merlin does not replace AI.
Merlin makes constrained AI usable.

AI 1.0 is approaching a reset because delivery is expensive, energy-intensive, compute-constrained, and still too dependent on chat babysitting for normal users.

Core spine:

Capture -> Compress -> Remember -> Verify -> Decide -> Execute -> Prove

See `docs/MERLIN_AI_2_0_DOCTRINE.md` for the one-page thesis and language guardrails.
See `docs/MERLIN_AI_COUNCIL_MISSION_BLUEPRINT.md` for the full mission execution blueprint.
See `docs/MERLIN_AI_COUNCIL_6_WEEK_EXECUTION_BOARD.md` for the owner-lane execution board, pass/fail gates, and KPI scoreboard.
See `docs/MERLIN_WEEKLY_SCOREBOARD_DATA_CONTRACT.md` for the weekly KPI data-source contract and authoritative query/output paths.

It is not a chatbot prompt collection. It is the operating contract that decides:

- which brand lane an action belongs to,
- which KPI the action supports,
- which source of truth must be checked,
- which tool is allowed to act,
- which permission level applies,
- which fail-safes block unsafe execution,
- and where the result must be recorded.

## Active brand lanes

### TradeScout

Audience: contractors and homeowners.

Primary KPI: verified contractor/homeowner connection outcomes.

Forbidden: lead selling, pay-to-play, paid visibility, ranking manipulation, and trading/sports crossover.

### MealScout

Audience: food trucks, event hosts, vendors, restaurants, and public food/event customers.

Primary KPIs: events created, hosts onboarded, vendors activated, online ordering working, parking booking working.

Money flows:

- Optional monthly plan: $25/month, reduced from $50/month, currently free until the system works.
- Online ordering: pass-through, customer pays processing, customer pays $1 MealScout fee.
- Parking booking: pass-through to host, vendor pays host price plus all fees, MealScout receives $10 added on top.

### Trader's Corner

Audience: trading and sports users only.

Status: separate lane. Not active unless explicitly selected.

### LISA

Role: Live Indexed Signal Adapter.

Job: ingest signals, score truth/newness, route to the right brand lane, and recommend or trigger actions only when safe.

## Core action loop

1. Receive intent.
2. Identify brand lane.
3. Identify KPI.
4. Pull source-of-truth context.
5. Validate required real data.
6. Select action type.
7. Apply permission and fail-safe rules.
8. Execute through the correct connector/tool.
9. Write result back to source of truth.
10. Report status clearly.

## Permission levels

- Level 0: read/inspect only.
- Level 1: safe organization.
- Level 2: drafted action.
- Level 3: real external action.
- Level 4: destructive or financial-risk action.

See `docs/permissions.md` for the full policy.

## Repository structure

```text
merlin-os-action-layer/
  docs/
    overview.md
    brand-lanes.md
    permissions.md
    mealscout-money-flows.md
    stripe-canonical-plan.md
  schemas/
    action-card.schema.json
    stripe-metadata.schema.json
    lisa-signal.schema.json
    mealscout-order.schema.json
    mealscout-parking-booking.schema.json
  contracts/
    lisa-signal-to-action.md
  policies/
    no-fake-data.md
    brand-separation.md
    financial-actions.md
  examples/
    mealscout-online-order.action.json
    mealscout-parking-booking.action.json
    tradescout-contractor-claim.action.json
```

## Non-negotiables

- No fake users.
- No fake events.
- No fake payment records.
- No guessed email recipients.
- No hidden fees.
- No cross-brand execution.
- No GitHub action in unconfirmed repos.
- No Stripe product/payment changes without real product, price, customer/event/order context, and explicit approval.

## Current status

This repo is the technical home for the action layer. Google Drive remains the business source of truth.

## Merlin OR OAuth-ready local startup

For Drive/OAuth work, start the service with:

```bash
npm run dev:or
```

That launcher explicitly loads `.env` before booting the OR service.

Validate readiness:

```bash
curl -s http://localhost:3030/api/drive/auth-health
```

Expected OAuth-ready response includes:

```json
{
  "status": "ready",
  "auth": {
    "ready": true,
    "configured": true
  },
  "managedFolders": {
    "ready": true
  }
}
```

For safety validation, also review reconciliation and auth-blocking behavior:

```bash
curl -s http://localhost:3030/api/drive/reconciliation
```

Expected read-only envelope:

```json
{
  "status": "ok",
  "mode": "read_only",
  "summary": {
    "checked": 0,
    "driftCount": 0,
    "blockingCount": 0,
    "warningCount": 0
  },
  "drift": []
}
```

When Drive auth is unhealthy, route/sync mutations return:

```text
409
{
  "error": "Drive auth unhealthy",
  "reason": "OAuth credentials are incomplete",
  "auth": {
    "ready": false,
    "configured": false
  }
}
```

Use `npm run dev` for workflows that do not require Google Drive OAuth integration.
