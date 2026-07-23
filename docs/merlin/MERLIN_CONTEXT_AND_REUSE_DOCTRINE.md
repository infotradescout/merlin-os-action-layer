# MERLIN Context and Reuse Doctrine

## Core Identity

Merlin App Builder is built to reduce AI drift by reusing proven patterns, tightening decision surfaces, and preserving execution context across time gaps.

This doctrine applies to all AI-assisted work before any slice is executed.

Merlin and Codex must treat every build move as context-aware, pattern-aware, and reversible.

## Core Law Set

### 1) Review-before-create

Before creating any new file, function, component, route, table, service, or pattern, Merlin/Codex must inspect what already exists.

Required check:

- Does this already exist?
- Can we reuse it?
- Can we extend it safely?
- Would creating a new duplicate architecture cause drift?

Default action:

`reuse → extend → create only if justified`

Codex cannot create new patterns until the review is recorded in the approved slice rationale.

### 2) Constrained-builder rule

Most users do not need a blank canvas; they need a guided path.

Merlin must reduce decision load by forcing a constrained journey:

- Choose goal
- Pick lane
- Drop component
- Customize text/data/style
- Validate
- Push

Merlin should not default to inventing every screen, component, or process from scratch.

Codex must use proven defaults, existing shell architecture, and existing patterns before proposing alternatives.

### 3) Shared component stash

Merlin must maintain reusable component/system assets for:

- Auth shells
- Landing sections
- Dashboards
- Admin panels
- Intake forms
- Review queues
- Cards
- Tables
- Map blocks
- Payment gates
- Upload flows
- Notification blocks
- Onboarding flows
- KPI panels

Each reusable component entry must include:

- Purpose
- Inputs
- Outputs
- Design Source Packet
- Props contract
- Data contract
- Validation checklist
- Enable/disable/revert notes
- Customization options

New components must be justified as a gap closure before creation.

### 4) Natural-language drop-in workflow

Merlin should support direct operator intent and route it to reusable implementation primitives:

Example:

“Add a review queue for uploaded food truck menus.”

Expected behavior:

- Find an existing queue component.
- Check repository patterns and reuse paths.
- Reuse/customize copy and data contracts.
- Create a tight, approved slice.
- Produce a Codex handoff packet.
- Run validations.
- Return PR-ready summary.

This is the approved workflow; recreating a brand-new workflow from scratch is not.

### 5) Timestamped work ledger

Every approved action must record:

- Created at
- Started at
- Completed at
- Last reviewed at
- Last user instruction at
- Last Codex run at
- Elapsed time since previous run
- Staleness status

Every action without timestamp coverage is incomplete.

### 6) Time-gap awareness

AI must treat elapsed time as context and adapt behavior by age of context:

- 1 minute later: continue current thread.
- 1 hour later: quick status check before action.
- 1 day later: provide project recap before next action.
- 1 week later: explicitly verify assumptions before implementation.
- 1 month later: treat context as stale until re-reviewed.

If time-gap context is stale, Codex must pause for explicit user/state review before continuing changes.

## Doctrine enforcement for each slice

- Confirm reuse opportunities before proposing new artifacts.
- Require explicit reason if duplication is introduced.
- Use the shared component stash before introducing new primitives.
- Record required timestamp fields in the slice ledger.
- Re-verify assumptions on long-gap context before applying code changes.
