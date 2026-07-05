# Merlin Repo Boundary Audit

Date: 2026-07-01

## Why this audit exists

This repo does not have a "MealScout should leave the repo" problem.

It has a boundary problem:

- Merlin core is real and useful.
- MealScout is a valid in-repo lane.
- Drive is a valid in-repo infrastructure layer.
- But the boundaries between those layers are not clear enough in code layout, route ownership, or runtime composition.

The result is that the repo reads like a MealScout/Drive operations monolith wearing a Merlin label instead of a Merlin-governed multi-lane system.

## Current reality

### Good architecture already present

The repo already contains the cleaner direction:

- `src/merlin/adapters/mealscoutAdapter.ts`
- `src/merlin/intake/intentRegistry.ts`
- `src/merlin/routes/merlinIntakeRoutes.ts`

That path models MealScout as a product adapter plugged into Merlin intake contracts.

### Dominant architecture actually running the app

The dominant runtime surface is still:

- `src/server.ts`

Observed characteristics:

- very large composition root and route handler
- directly imports Merlin, MealScout, and Drive modules together
- directly owns large MealScout intake and Drive review surfaces
- directly serves operator/admin HTML files

This makes `server.ts` both:

- app bootstrap/composition root
- product orchestrator
- infrastructure router
- admin UI file server

That is the main architectural drift.

## Layer model that should govern this repo

### Merlin core

Merlin is allowed to read from and write to MealScout.

Merlin core should own:

- shared intake contracts
- shared action-card/runtime primitives
- approval logic
- execution planning
- dry-run and live-gate policy
- operator review framework
- search/scoreboard/workspace abstractions

Examples:

- `src/merlin/intakeRuntime.ts`
- `src/merlin/actionCardRuntime.ts`
- `src/merlin/approvalRuntime.ts`
- `src/merlin/executionPlanRuntime.ts`
- `src/merlin/dryRunExecutorRuntime.ts`
- `src/merlin/liveExecutionGateRuntime.ts`
- `src/merlin/operatorConsoleRuntime.ts`
- `src/merlin/workspaceRuntime.ts`

### MealScout lane

MealScout should own:

- screenshot extraction
- evidence clustering
- profile import/update logic
- review decisions/corrections/attachments
- publish-plan and publish-execution logic
- affiliate attribution logic
- MealScout-specific operator review routes and UI

Examples:

- `src/mealscoutProfileImport.ts`
- `src/mealscoutEvidenceClustering.ts`
- `src/mealscoutScreenshotExtraction.ts`
- `src/mealscoutPublishPlan.ts`
- `src/mealscoutPublishExecution.ts`
- `src/mealscoutAffiliateAttributionKpiRollup.ts`
- `src/merlin/routes/mealscoutActionCardRoutes.ts`

### Drive infrastructure

Drive should own:

- auth
- client wrappers
- manifest/review queue plumbing
- folder sync/reconciliation
- Drive review UI surfaces

Examples:

- `src/driveAuth.ts`
- `src/driveClient.ts`
- `src/driveManifest.ts`
- `src/driveReviewQueue.ts`
- `src/driveSync.ts`
- `public/drive-review-queue.html`

## Mis-homed files

These files may stay in the repo, but they currently live in a misleading conceptual home.

### Merlin namespace but product-heavy

- `src/merlin/profileSeedRuntime.ts`
  - mixes MealScout extraction, MealScout profile persistence, TradeScout seeding, affiliate attribution, and verification email side effects
  - this is not a neutral Merlin primitive

- `src/merlin/affiliateScreenshotFolderProcessing.ts`
  - combines Drive folder walking, affiliate attribution, screenshot processing, and brand-specific seeding/export behavior
  - this is a workflow lane, not a generic Merlin runtime

- `src/merlin/intake/actionCardApplyRuntime.ts`
  - file name sounds generic
  - current runtime is explicitly MealScout-shaped

- `src/merlin/routes/mealscoutActionCardRoutes.ts`
  - correctly MealScout-specific in behavior
  - but its existence highlights that other large MealScout route surfaces still bypass route modules and remain embedded in `server.ts`

## Files that look like valid shared core

- `src/merlin/intakeRuntime.ts`
- `src/merlin/actionCardRuntime.ts`
- `src/merlin/approvalRuntime.ts`
- `src/merlin/executionPlanRuntime.ts`
- `src/merlin/dryRunExecutorRuntime.ts`
- `src/merlin/liveExecutionGateRuntime.ts`
- `src/merlin/operatorConsoleRuntime.ts`
- `src/search.ts`

These files still look like real Merlin-wide primitives and aggregators.

## Root clutter and operational bleed

This repo also contains non-boundary clutter that amplifies the confusion:

- committed runtime DB under `data/`
- committed artifact outputs under `artifacts/`
- many root-level reports/logs/json outputs
- admin/operator UI files served directly from the same monolithic server

These do not prove the architecture is wrong by themselves, but they make the repo read more like an operations workspace than a clean application source tree.

## What is bypassing the cleaner architecture

The repo already has adapter/registry concepts, but many of the most important MealScout and Drive behaviors do not flow through those abstractions.

Large direct surfaces still handled in `src/server.ts` include:

- Drive import/sync/auth/reconciliation/review endpoints
- admin file serving for Drive review and MealScout review
- MealScout preview
- MealScout batch intake
- MealScout file audit
- MealScout candidate import
- MealScout folder context
- MealScout duplicate removal
- MealScout affiliate attribution reporting
- MealScout publish-plan execution/audit
- MealScout review decisions/corrections/attachments

This means the strongest architectural idea in the repo is not the one actually governing the biggest product surfaces.

## What "working" should mean

The repo works when all of these are true:

1. Merlin can still read from and write to MealScout.
2. Merlin core is visibly distinct from MealScout lane logic.
3. `server.ts` is a thin composition root, not the main product engine.
4. Product-specific route clusters are delegated to owned route modules.
5. Shared runtime files are generic in naming and behavior.
6. Brand-specific mutative workflows do not hide under misleading generic Merlin filenames.

## The deeper execution mismatch

The repo is also split across two different definitions of "Merlin execution."

### Definition A: generic Merlin execution pipeline

These files form a real generic chain:

- `src/merlin/actionCardRuntime.ts`
- `src/merlin/approvalRuntime.ts`
- `src/merlin/executionPlanRuntime.ts`
- `src/merlin/connectorAdapterRuntime.ts`
- `src/merlin/dryRunExecutorRuntime.ts`
- `src/merlin/liveExecutionGateRuntime.ts`

That chain is useful, but it currently models:

- action cards
- approvals
- execution plans
- connector adapter checks
- dry-run simulation
- live execution gates

What it does **not** model is product-owned apply behavior.

### Definition B: actual MealScout mutation path

Real create/update behavior currently happens outside the generic execution chain:

- `src/merlin/routes/mealscoutActionCardRoutes.ts`
- `src/mealscoutProfileImport.ts`
- `src/mealscoutPublishExecution.ts`
- `src/merlin/profileSeedRuntime.ts`

Examples:

- `mealscoutActionCardRoutes.ts` directly creates or updates MealScout profiles.
- `profileSeedRuntime.ts` directly creates or updates MealScout profiles.
- `mealscoutPublishExecution.ts` directly applies publish-plan writes.

So the repo has a generic "execution" story and a separate real mutation story.

That is a major reason the system feels smaller or wrong relative to the intended product.

### Why that matters for the intended end-state

The intended user story is:

- drop media
- detect intent
- preview exact changes
- approve
- apply into the target system

But the current architecture splits that story in half:

- the Merlin intake/packet side is heavily optimized for read-only preview contracts
- the Merlin generic execution side is optimized for dry-run connector governance
- the real MealScout writes still happen in product-specific routes and product-specific write helpers

That means there is no single canonical Merlin contract for:

- "what does apply mean?"
- "who owns field-level mutation authority?"
- "how does a product adapter translate preview-approved intent into product writes?"

### Exact missing abstraction

`ProductAdapter` currently supports:

- action registration
- intent validation
- preview context building

It does **not** support:

- preview-to-apply translation
- dry-run apply planning
- field-level mutation execution
- product write adapters
- apply result normalization

So the repo has a preview adapter architecture, but not yet a true apply adapter architecture.

## The read-only contract is stronger than the apply contract

Another major drift is that recent work made the read-only contract extremely explicit:

- packet contracts hard-false authority flags
- preview contracts
- operator review contracts
- dry-run/live-gate contracts

Meanwhile the apply side is narrower and more ad hoc.

Today the codebase is better at saying:

- "here is what would change"
- "here is why we are not applying"
- "here is the approval/dry-run paper trail"

than it is at saying:

- "here is the one canonical path for safe product mutation"

That asymmetry is architectural, not accidental.

## The user-facing surface mismatch

Another core mismatch is about **what Merlin is supposed to feel like to the user**.

### Intended role

Merlin is supposed to be the user-facing action layer.

That means the user's mental model is closer to:

- one Merlin surface
- user drops media or provides intent
- Merlin understands the target lane
- Merlin previews exact changes
- Merlin asks for approval when needed
- Merlin applies into the target system

In other words:

- conversational or command-driven front door
- action system behind it
- multiple product lanes behind the action system

### Current role in this repo

The repo currently presents Merlin mostly as:

- `Merlin Daily`
- Drive review queue
- MealScout OCR review queue
- Merlin operator review
- action-card/approval/dry-run/live-gate APIs

Those are useful control-plane surfaces, but they are not the primary user-facing Merlin layer.

### Evidence of the drift

Current public/admin UI surfaces are:

- `public/index.html`
- `public/drive-review-queue.html`
- `public/mealscout-review-queue.html`
- `public/merlin-operator-review.html`

These are:

- dashboard-like
- review-oriented
- operator-oriented
- fragmented by subsystem

They are not one unified Merlin action surface.

The text inside those pages reinforces the same posture:

- "Daily Command Center"
- "Drive Review"
- "MealScout OCR Review"
- "inspect advisory chain output"
- "No mutation, implementation, execution, apply, or executor wiring is exposed here"

That is a control-plane UX, not a user-facing Merlin UX.

### Doctrine conflict

The repo's internal doctrine often frames the project as:

- not another chatbot
- not prompt-first software
- not a generic blank-prompt interface

That is a valid doctrine if the goal is "operational system instead of chatbot."

But it can still drift too far if it suppresses the need for a real user-facing action surface.

The practical result here is:

- the repo invested in review/control surfaces
- but did not yet unify those capabilities behind one Merlin front door

### What this means architecturally

If Merlin is the user-facing action layer, then these should be downstream support layers:

- Daily summary
- review queues
- approval gates
- dry-run gates
- operator presentations

They should support the main Merlin surface, not replace it.

Right now they effectively replace it.

## Exact missing layers for the intended Merlin model

Target model:

- users connect outside sources
- Merlin becomes the single action surface for those sources
- Merlin uses context + user input + connected-state evidence
- AI Council and Roundtable stay behind the scenes
- product repos and source systems feed context and execution capability into Merlin

Below is the exact gap map.

### 1. Source connection layer

What this layer should do:

- let a user connect or disconnect a source
- store connection ownership and scope
- show source health and auth status
- expose what Merlin is allowed to do with that source
- separate "available connector type" from "this user/workspace connected instance"

What already exists:

- connector definitions in docs:
  - `docs/overview.md`
  - `docs/permissions.md`
- Drive auth config/profile:
  - `src/driveAuth.ts`
- connector adapter inventory/checks:
  - `src/merlin/connectorAdapterRuntime.ts`
  - `src/merlin/routes/merlinConnectorAdapterRoutes.ts`
- source registry:
  - `src/sourceRegistry.ts`

What is still missing:

- no user-facing "connect source" flow
- no persisted connected-account model per user/workspace
- no normalized source connection record like:
  - source provider
  - account owner
  - granted scopes
  - health
  - status
  - last sync/check
- no distinction between:
  - "Merlin supports Gmail"
  - "Thomas connected his Gmail account"
- no unified source-connection API

Current state:

- connector capability scaffolding exists
- connected-source product layer does not

### 2. Unified Merlin thread/session layer

What this layer should do:

- give the user one ongoing Merlin interaction surface
- hold user intent, uploads, follow-up questions, approvals, and results in one thread/session model
- unify:
  - "drop media"
  - "ask Merlin to do something"
  - "review the preview"
  - "approve or revise"
  - "see what happened"

What already exists:

- intake items:
  - `src/merlin/intakeRuntime.ts`
- upload intents:
  - `src/merlin/intake/uploadIntentStore.ts`
  - `src/merlin/routes/merlinIntakeRoutes.ts`
- operator console summaries:
  - `src/merlin/operatorConsoleRuntime.ts`
- search + evidence retrieval:
  - `src/search.ts`
  - `src/merlin/search/merlinSearch.ts`

What is still missing:

- no real Merlin conversation/thread model
- no first-class session object that links:
  - source connections
  - prompts/instructions
  - uploads
  - packets
  - approvals
  - execution results
- no single "Merlin shell" page or API contract for the full loop
- current UI is split into multiple operator/review pages instead

Current state:

- intake/event primitives exist
- session shell does not

### 3. Source capability registry

What this layer should do:

- express what Merlin can do with each connected source
- separate read capabilities from draft and execution capabilities
- express capability by:
  - provider
  - object type
  - action
  - risk level
  - approval requirement
  - required evidence/context

What already exists:

- permission levels:
  - `docs/permissions.md`
- connector adapter contract/checking:
  - `src/merlin/connectorAdapterRuntime.ts`
- product action registration:
  - `src/merlin/intake/intakeTypes.ts`
  - `src/merlin/intake/intentRegistry.ts`
  - `src/merlin/adapters/mealscoutAdapter.ts`
- workspace/brand gating:
  - `src/merlin/workspaceRuntime.ts`

What is still missing:

- no unified capability registry that combines:
  - connector/provider capability
  - product-lane capability
  - user/workspace authorization
  - source connection scope
- current connector adapters are execution-plan checks, not user-facing capability declarations
- current product adapters are preview/intake-oriented, not full capability maps
- no model like:
  - "for this connected Gmail account, Merlin can search, draft, and send with approval"
  - "for this connected MealScout lane, Merlin can preview and apply profile/menu/schedule changes"

Current state:

- capability fragments exist
- one canonical capability registry does not

### 4. Preview / approval / apply contract across sources and product systems

What this layer should do:

- turn intent + context + source data into a preview
- support revision and clarification
- request approval when needed
- execute through the correct source or product adapter
- normalize result and proof artifacts

What already exists:

- preview contracts:
  - `src/merlin/intake/universalProductUpdatePacket.ts`
  - `src/merlin/intake/universalProductUpdatePacketPreview.ts`
  - `src/merlin/intake/previewBuilder.ts`
- approvals:
  - `src/merlin/approvalRuntime.ts`
- execution plans / dry runs / live gates:
  - `src/merlin/executionPlanRuntime.ts`
  - `src/merlin/dryRunExecutorRuntime.ts`
  - `src/merlin/liveExecutionGateRuntime.ts`
- real MealScout writes:
  - `src/merlin/routes/mealscoutActionCardRoutes.ts`
  - `src/mealscoutProfileImport.ts`
  - `src/mealscoutPublishExecution.ts`

What is still missing:

- no single apply contract shared across:
  - connector actions
  - product writes
  - future external systems
- no `ProductAdapter` apply interface
- no canonical bridge from:
  - upload intent / preview packet
  - approval
  - product or connector execution
- actual writes still live in lane-specific code paths instead

Current state:

- preview and governance are stronger than apply
- apply is real but not unified

## What the repo needs to become

For the intended model, the repo should evolve into this stack:

### User shell

- Merlin front door
- source connection management
- thread/session UX
- media drop + command input
- preview / approval / result view

### Merlin orchestration core

- intent classification
- context retrieval from LISA and app sources
- capability resolution
- approval routing
- apply orchestration
- outcome/proof recording

### Hidden governance layer

- AI Council challenge/review packets
- Roundtable authority rules
- risk and doctrine gates
- escalation and refusal logic

### Source and product adapter layer

- Gmail adapter
- Calendar adapter
- Drive adapter
- GitHub adapter
- Stripe adapter
- MealScout adapter
- TradeScout adapter
- future app/source adapters

### Evidence and context layer

- LISA
- platform state
- source registry
- evidence index
- replay and audit records

## Bottom-line architecture correction

The intended system is not:

- Merlin as just a router
- AI Council as the user surface
- product review queues as the main interface

The intended system is:

- Merlin as the user-facing action shell
- AI Council and Roundtable as hidden thinking/governance layers
- repos and connected sources as context + capability providers behind Merlin

This repo currently contains many of the backend pieces for that future state, but the top-level product shape is still upside down.

## First refactor order

### 1. Thin the composition root

Highest-value first step:

- reduce `src/server.ts`

Move direct route ownership out of the monolith into dedicated route modules for:

- Drive operations
- MealScout intake/review/publish operations
- admin/public operator surfaces

### 2. Re-home misleading Merlin files inside the repo

Keep behavior, change conceptual ownership:

- `src/merlin/profileSeedRuntime.ts`
- `src/merlin/affiliateScreenshotFolderProcessing.ts`
- `src/merlin/intake/actionCardApplyRuntime.ts`

These should live where their product/workflow ownership is obvious.

### 3. Preserve the good Merlin abstractions

Do not collapse or rewrite the parts that already look right:

- adapter/intent registry
- shared action-card runtime
- approval/execution/dry-run/live-gate stack
- operator console/search/workspace layer

### 4. Quarantine runtime state and generated operations clutter

Reduce architectural noise from:

- `data/**`
- generated artifacts
- root-level logs and one-off reports

### 5. Create a real apply adapter contract

The next architecture step after route thinning should be a new shared contract, not another proof packet.

Merlin needs a product-owned but core-shaped apply seam, for example:

- `buildApplyPlan(packet, operatorDecision)`
- `validateApplyPlan(plan)`
- `executeApplyPlan(plan)`
- `normalizeApplyResult(result)`

That seam should be implemented per product lane:

- MealScout apply adapter
- TradeScout apply adapter
- later lanes after that

Until that exists, "Merlin" will keep meaning preview/governance on one side and product-specific mutation glue on the other.

### 6. Introduce a real Merlin front door

After route thinning and apply-adapter work, the repo needs a first-class Merlin front door:

- one request surface for user intent
- one session/thread model
- one media drop path
- one preview/approval/apply loop
- product lanes selected behind the Merlin surface instead of by making users jump between review UIs

That does not require becoming a generic chatbot.

It does require giving Merlin one coherent user-facing action interface instead of several operator-first islands.

## Bottom line

The repo is not wrong because Merlin touches MealScout.

It is wrong because:

- the clean Merlin-governs-MealScout architecture exists
- but the largest runtime surfaces still bypass it
- and several product-heavy files are conceptually parked under generic Merlin ownership
- and the apply path is not yet unified under the same adapter/governance model as intake and preview
- and the current user-facing experience is fragmented across command-center and review surfaces instead of one Merlin action interface

That is the central mismatch between the intended architecture and the codebase as it exists today.
