# LISA Signal To Action Contract

## Purpose

This contract defines how LISA turns a signal into a safe action recommendation.

LISA does not execute blindly. It scores, routes, and blocks when required data is missing.

## Required signal fields

- signal_id
- source
- brand_lane
- signal_type
- entity
- observed_at
- truth_score
- newness_score
- recommended_action
- review_required

## Routing rules

TradeScout signals route only to TradeScout actions.

MealScout signals route only to MealScout actions.

Trader's Corner signals route only to Trader's Corner actions.

MerlinOS signals route only to internal operating actions.

## Blocking rules

LISA must block an action when:

- brand lane is unclear,
- required real data is missing,
- source is untrusted,
- signal is stale,
- truth score is below action threshold,
- newness score is below action threshold,
- action would mix brand lanes,
- action would affect payment state without explicit approval,
- or action would create fake records.

## Output

A valid routed signal should become an Action Card.

See `schemas/action-card.schema.json`.