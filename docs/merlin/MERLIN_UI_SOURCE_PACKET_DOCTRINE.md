# Merlin UI Source Packet Doctrine

## Why this doctrine exists

Screenshots are lossy. They show a result, but they hide how the system should actually be built:

- layout rules
- component hierarchy
- spacing scale
- state logic
- responsive behavior
- content rules
- data bindings
- interactions
- accessibility constraints
- design tokens

Merlin must not treat screenshots as a source of truth for implementation.

## Core doctrine

- **Image output is visual proof only.**
- **Structured design data is the build source.**
- Before any visual mockup or implementation handoff, Merlin must generate and persist a **Design Source Packet** for each UI screen.
- Codex must implement from the Design Source Packet, not from screenshot vibes.
- Do not ask Codex to recreate screenshots.
- Visual assets are optional references for validation, not canonical specs.

## App Builder flow

1. User intent  
2. Design Source Packet  
3. Visual mockup/image (reference artifact only)  
4. Component blueprint  
5. Codex implementation  
6. Browser screenshot comparison  
7. Correction loop  
8. Design Source Packet refinement + re-validation

## New screen contract: required fields

Every UI screen packet must define:

- **Screen purpose**
- **User role**
- **Primary action**
- **Component tree**
- **Layout grid**
- **Design tokens**
- **Spacing scale**
- **Typography**
- **Color tokens**
- **Content hierarchy**
- **Interaction states**
- **Responsive rules**
- **Data dependencies**
- **Acceptance criteria**

## Critical operating instruction

When assigning Codex work, use this language pattern:

> Implement this component tree using these tokens, layout rules, interaction states, responsive rules, and acceptance criteria.
> Use the screenshot as visual reference only.

Avoid prompts that say:

> Recreate this screenshot.

## Packet quality bar

- Every field in the packet must be concrete.
- Fields cannot be inferred from fake or invented design data.
- If required data is missing, record an explicit blocking assumption in the packet before moving forward.
- Codex handoffs must reference packet ID + required screen constraints.

## Validation rule

Validation is required against structured output and behavior, then confirmed by screenshot comparison:

- render consistency against declared layout and hierarchy
- token conformance (spacing, colors, typography)
- state behavior correctness
- responsive breakpoint behavior
- data binding correctness
- accessibility checks
- accessibility and interaction regression checks via browser run

Any validation failure must route back to packet refinement before implementation approval.

## Canonical flow for each change

1. Capture intent
2. Build/Update Design Source Packet
3. Review packet completeness
4. Generate visual mockup as reference
5. Generate component blueprint
6. Implement from blueprint + packet
7. Run browser comparison and state tests
8. Patch packet if behavior drift is observed
