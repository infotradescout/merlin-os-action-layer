# AI Parallel Execution

This document defines the operating model for safe parallel AI execution across active Merlin-governed repositories.

This is an operating doctrine for repository work. It does not authorize product behavior changes by itself.

## Authority Model

- Gawain defines doctrine, slice scope, and merge order.
- Codex implements one assigned lane per session.
- Gemini reviews and criticizes.
- Gawain reconciles Gemini criticism and issues corrected prompts.
- Gemini criticism is not optional. It must be addressed, accepted with correction, or explicitly resolved by Gawain.

## Core Rule

One Codex session works one lane on one branch.

Codex may not stack unrelated work, merge lanes informally, or use one session as a catch-all cleanup pass.

## Required Operating Rules

- One lane per Codex session.
- One branch per lane.
- No stacked unrelated work.
- Inspect first, then edit.
- Choose the smallest safe slice.
- Add or update contracts/tests before behavior when possible.
- No fake status.
- No fake commits.
- No fake test results.
- No cross-brand imports.
- Do not touch files outside the assigned lane unless reported.
- Run validation before commit.
- Gemini review is required before merge.
- Gawain controls merge order.

## Inspect First

Before editing, Codex must inspect:

- Current branch and baseline SHA.
- Git status.
- Existing target files.
- Repo validation commands.
- Lane-specific allowed and banned files.
- Relevant doctrine.

If target files already exist, Codex must preserve useful existing content and must not silently overwrite prior governance decisions.

## Smallest Safe Slice

Each lane must be scoped to the smallest useful change that can be reviewed independently.

Forbidden patterns:

- Broad cleanup while implementing a slice.
- Combining docs, runtime behavior, UI polish, migrations, and test rewrites unless one route packet explicitly requires that bundle.
- Touching unrelated brand surfaces to make validation easier.

## Contracts And Tests Before Behavior

When behavior changes are assigned, Codex should add or update contract/test coverage before changing behavior when practical.

If tests cannot be added first, Codex must report why and capture alternative evidence.

## Status Integrity

Codex must not claim:

- A commit exists when it does not.
- Tests passed when they did not run.
- A route is live without served-reality evidence.
- A product behavior changed without inspecting the relevant files.
- Gemini review happened when it did not.

## Brand-Lane Isolation

Do not import doctrine, data, UI copy, runtime helpers, or customer assumptions from another brand lane.

Known brand lanes include:

- TradeScout
- MealScout
- Trader's Corner
- LISA
- Merlin shared governance

Cross-brand work requires explicit lane assignment and Gawain approval.

## Outside-Lane File Touches

If Codex discovers an outside-lane file must be touched:

1. Stop if the touch would broaden product behavior.
2. Report the file, reason, and risk.
3. Proceed only if the change is necessary for validation or explicitly approved by the route packet.
4. Include the outside-lane touch in the final return.

## Validation Before Commit

Codex must discover the repo validation command before committing.

If a repo has package scripts, inspect them.

If no validation command exists, Codex must report that honestly and must not invent one.

Validation results must include exact command and result.

## Gemini Review Gate

Gemini review is required before merge.

Codex return packets must leave enough evidence for Gemini to review:

- Baseline SHA
- Branch
- Files inspected
- Files changed
- Tests run
- Test results
- Risks and follow-up

Gawain reconciles Gemini criticism and controls whether a corrected prompt, follow-up slice, or merge is next.

## Merge Order

Gawain controls merge order across lanes.

Codex must not assume its lane should merge first because it finished first.

If two lanes conflict, Gawain chooses the merge order and may issue corrected prompts.

## Global Return Format

Every Codex lane must return:

- repo
- lane chosen
- branch
- baseline SHA
- files inspected
- files changed
- tests run
- test results
- commit SHA if committed
- PR link if opened
- final git status
- risks / follow-up needed

## Hard Non-Goals

This operating-doc slice does not:

- Modify application behavior.
- Alter product copy.
- Import doctrine from another brand.
- Make broad cleanup changes.
- Rename existing files.
- Claim tests passed unless they actually ran.
