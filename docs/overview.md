# Merlin OS Action Layer Overview

## Definition

The Merlin OS Action Layer is a controlled execution system for moving from intent to action without losing brand separation, source-of-truth discipline, or operational safety.

It sits between the user, LISA, connected tools, and future application code.

## Core responsibility

Before any action happens, the system identifies:

1. The brand lane.
2. The measurable KPI.
3. The real data required.
4. The allowed tool.
5. The rule that blocks unsafe execution.

## Active connectors

- Google Drive: source of truth, operating docs, audit records.
- Gmail: communication search, labeling, drafts, and sends only when allowed.
- Google Calendar: real events, commitments, follow-ups, and operating cadence.
- Stripe: payment state and payment-object review.
- Canva: editable brand output, folders, designs, and templates.
- GitHub/Codex: implementation only after the correct repo is confirmed.

## Action flow

Intent → Brand lane → KPI → Source check → Data check → Permission level → Tool selection → Rule check → Execution → Audit record.

## Source of truth hierarchy

1. Direct user-provided real data in the current task.
2. Locked Google Drive operating docs.
3. Live connector state from Stripe, Gmail, Calendar, Canva, or GitHub.
4. Application database or LISA state when connected later.
5. Recommendation only when no action is being executed.

## Non-goals

The action layer is not a general chat memory dump, a fake CRM, a payment shortcut without review, a replacement for product code, or a cross-brand funnel.

## First implementation target

The first technical target is the Action Card schema. Every future action should be represented as a structured object before execution.

See `schemas/action-card.schema.json`.