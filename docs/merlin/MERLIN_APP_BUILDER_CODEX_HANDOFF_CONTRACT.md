# MERLIN APP BUILDER CODEX HANDOFF CONTRACT

## Purpose

This contract defines how Merlin App Builder hands work to Codex.

Codex is the execution engine.

Merlin is the intake, routing, governance, memory, validation, and project-state layer.

Albion Council is the governance review layer.

Human authority is final.

## Non-Negotiable Rules

Codex must not receive executable implementation work until:

1. Project doctrine exists.
2. A Project Flight Plan exists.
3. A build slice exists.
4. The build slice has acceptance criteria.
5. The build slice has validation commands or a documented validation fallback.
6. Required evidence has been attached or explicitly marked missing.
7. Required Council review points have been identified.
8. Human approval has authorized the slice for execution.

## Codex Role

Codex may:

- Inspect repositories
- Modify code
- Add tests
- Update documentation
- Run validation commands
- Fix failures
- Prepare commits
- Prepare pull requests
- Report risks

Codex may not:

- Override doctrine
- Skip acceptance criteria
- Bypass human approval
- Treat model output as evidence
- Self-authorize execution
- Change project authority rules
- Rewrite governance records
- Alter audit history
- Ignore known constraints

## Required Handoff Packet

Every Codex task must include:

```text
Project Name
Repository
Branch
Doctrine Reference
Project Flight Plan Reference
Build Slice ID
Slice Goal
Context Summary
Evidence References
Files to Inspect
Required Changes
Forbidden Changes
Acceptance Criteria
Validation Commands
Rollback Risk
Enable Instructions
Disable Instructions
Revert Instructions
Data Non-revertibility Notes
Safe-disable behavior
Expected User-Visible Outcome
Commit Message
PR Summary
```

## Required Codex Return Packet

After execution, Codex must return:

```text
Files Changed
Implementation Summary
Validation Commands Run
Validation Results
Enable Instructions
Disable Instructions
Revert Instructions
What breaks if reverted
What data cannot be reverted
Validation after revert
Known Risks
Unresolved Questions
Commit SHA
PR Link or PR Summary
Next Recommended Slice
```

## Enable / Disable / Revert Contract

Every accepted slice must define:

- Feature flag or config gate when applicable
- How to enable the change
- How to disable the change
- How to revert the change
- Safe-disable behavior
- User impact if disabled
- Validation steps after revert
- Migration rollback requirements when applicable
- Deployment rollback requirements when applicable
- Data that cannot be reverted

## Approval Boundaries

Codex output is not automatically accepted.

Merlin must review Codex output against:

- Doctrine
- Flight Plan
- Acceptance criteria
- Validation results
- Known risks
- Council review requirements

Human approval is required before merge, deploy, or escalation to a larger slice.

## Model-Agnostic Boundary

Users may plug in their own AI models to assist with planning, drafting, research, or implementation support.

User-connected models do not own governance.

Merlin owns:

- Intake
- Memory
- Evidence
- Routing
- Truth Logic
- Validation
- Audit history
- Project state

Albion Council owns governance review.

Human authority remains final.

Model swaps must not alter memory, evidence, decisions, governance records, audit history, or project state.

## Anti-Drift Enforcement

Every Codex handoff must point back to the Project Flight Plan.

If Codex discovers the requested work conflicts with doctrine, the Flight Plan, validation requirements, or evidence, Codex must stop and report the conflict instead of improvising.

## Standard Slice Command

```text
Act as the execution engineer for this approved Merlin App Builder slice.

Follow the attached doctrine, Project Flight Plan, and acceptance criteria.

Do not broaden scope.
Do not skip validation.
Do not rewrite governance.
Do not self-authorize changes outside the slice.

Inspect the repository, implement the approved slice, run validation, fix failures within scope, and return the required Codex Return Packet.
```
