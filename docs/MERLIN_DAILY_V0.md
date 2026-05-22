# Merlin Daily v0

## Purpose

Merlin Daily v0 is the first read-only OR surface.

It is not a chatbot.

It is a daily coordination view powered by LISA context.

The goal is to help users understand:

- what changed,
- what matters,
- what is waiting,
- what is stale,
- and what should happen next.

## Product principle

Chat starts from the prompt.

Merlin starts from what is already happening.

## First user experience

A user opens Merlin Daily and sees:

- Changed
- Needs attention
- Waiting
- Stale
- Suggested next steps

## Example

Changed:
- A business profile uploaded a new verification document.
- A customer uploaded project photos.

Needs attention:
- One insurance document needs review.
- Two contact requests are aging.

Waiting:
- One customer has not replied after a quote was sent.

Suggested next step:
- Send a short follow-up and review the insurance upload.

## v0 scope

Merlin Daily v0 is read-only.

It should:

- retrieve compact current context from LISA,
- show important changes,
- show stale items,
- surface suggested next steps,
- and explain what records support those suggestions.

It should not:

- mutate source state,
- send external messages automatically,
- change verification state,
- or execute financial actions.

## Initial endpoints

- GET /api/health
- GET /api/daily
- GET /api/search?q=

## First proof vertical

TradeScout.

TradeScout creates the first usable OR loop because:

- businesses have identities,
- jobs create events,
- verification matters,
- confidence matters,
- outcomes matter,
- and stale data has real consequences.

## The first OR loop

TradeScout event
→ Reality Substrate
→ LISA search/state
→ Merlin Daily
→ suggested next step
→ later approved action
→ outcome
→ updated state

## Success condition

A user should feel:

- this knows what changed,
- this found something I forgot,
- this helps me follow through,
- and this is more useful than opening a blank chat.
