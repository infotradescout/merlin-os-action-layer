# Repo Lanes

## Repo Name

`merlin-os-action-layer`

Package name: `merlin-or`

## Repo Doctrine

Primary doctrine references:

- `docs/AI_PARALLEL_EXECUTION.md`
- `docs/ai-build-process/AI_NATIVE_APP_BUILDING_PROCESS.md`
- `docs/ai-build-process/ROUTE_PACKET_TEMPLATE.md`
- `docs/ai-build-process/SERVED_REALITY_CHECKLIST.md`
- `docs/ai-build-process/ledger/LEDGER_SCHEMA.md`
- `docs/brand-lanes.md`
- `docs/merlin/MERLIN_PROJECT_FLIGHT_PLAN_DOCTRINE.md`
- `docs/merlin/MERLIN_AI_FAILURE_PREVENTION_DOCTRINE.md`

Repo doctrine:

- One lane per Codex session.
- One branch per lane.
- Brand lanes remain isolated.
- Docs-only lanes must not touch runtime behavior.
- Runtime lanes must include validation and, when production-facing, served-reality evidence.
- Gemini review is required before merge.
- Gawain controls merge order.

## Safe Parallel Lanes

These lanes may run in parallel when each uses its own branch and stays inside allowed files.

### Merlin Governance Docs Lane

Purpose: update operating doctrine, process docs, route templates, ledger schemas, and governance contracts.

Allowed files:

- `docs/**`
- `scripts/*.contract.test.mjs` only when a governance contract placeholder is explicitly assigned

Banned files:

- `src/**`
- `server/**`
- `public/**`
- `tests/**` unless explicitly assigned as docs/governance contract tests
- `data/**`
- `artifacts/**`
- runtime package or build config unless explicitly assigned

Validation expectation:

- Discover validation from `package.json`.
- Default lightweight validation: `npm run check`.

### Merlin Intake / Action-Layer Runtime Lane

Purpose: bounded runtime work in Merlin intake, action cards, routing, operator review, or execution-gate logic.

Allowed files:

- `src/merlin/intake/**`
- `src/merlin/routes/**` for assigned Merlin route behavior
- `tests/merlin-*.test.ts`
- `scripts/merlin-*.contract.test.mjs` when assigned
- related docs only when required by the route packet

Banned files:

- `public/**` unless UI behavior is explicitly assigned
- MealScout-only docs or public pages unless explicitly assigned
- TradeScout-only docs or public pages unless explicitly assigned
- database files and generated artifacts

Validation expectation:

- `npm run check`
- focused test command from the route packet
- `npm run test:contracts` when contract behavior changes

### Operator / Admin UI Lane

Purpose: bounded changes to admin or operator UI surfaces.

Allowed files:

- `public/**` for assigned surfaces
- corresponding route files in `src/merlin/routes/**` only when needed by the assigned UI surface
- browser or integration tests explicitly named by the route packet
- related docs only when required

Banned files:

- unrelated runtime engines
- unrelated brand pages
- database stores unless explicitly assigned
- generated artifacts

Validation expectation:

- `npm run check`
- focused UI/integration tests from the route packet
- served-reality checklist when production-facing

### MealScout Lane

Purpose: MealScout-specific workflows, docs, OCR, menu, vendor, host, event, order, or parking behavior.

Allowed files:

- MealScout-specific docs
- MealScout-specific public/admin pages
- MealScout-specific tests and scripts
- assigned shared files only when reported and required

Banned files:

- TradeScout-only workflows
- Trader's Corner workflows
- unrelated Merlin governance docs unless assigned
- invented hosts, events, vendors, orders, or payments

Validation expectation:

- `npm run check`
- focused MealScout tests/contracts from the route packet
- served-reality checklist when production-facing

### TradeScout Lane

Purpose: TradeScout contractor/homeowner trust routing, county context, scout decision cards, and community builder asset routing.

Allowed files:

- TradeScout-specific docs
- TradeScout-specific source, routes, tests, and scripts when assigned
- assigned shared files only when reported and required

Banned files:

- MealScout food/event workflows
- Trader's Corner trading or sports workflows
- paid ranking, paid visibility, or lead-selling behavior
- invented contractor/homeowner data

Validation expectation:

- `npm run check`
- focused TradeScout tests/contracts from the route packet
- served-reality checklist when production-facing

### Tests / Contracts Lane

Purpose: add or update tests and contract guards before or alongside assigned behavior.

Allowed files:

- `tests/**`
- `scripts/*.contract.test.mjs`
- minimal fixture updates required by tests
- docs only when the route packet assigns test documentation

Banned files:

- runtime behavior unless explicitly assigned
- product UI unless explicitly assigned
- broad fixture rewrites

Validation expectation:

- `npm run check`
- focused test command
- `npm run test:contracts` when contract tests change

## Unsafe Lane Pairings

Avoid running these lanes in parallel unless Gawain explicitly orders merge sequencing:

- Runtime lane plus tests/contracts lane touching the same behavior.
- Operator/Admin UI lane plus route/runtime lane for the same endpoint.
- MealScout lane plus shared routing/intake lane.
- TradeScout lane plus shared routing/intake lane.
- Governance docs lane plus another lane editing the same doctrine files.
- Any two lanes editing `package.json`, `tsconfig.json`, server wiring, or shared stores.
- Any two lanes requiring migrations, persistence changes, or generated artifact updates.

If unsafe pairing is discovered after work begins, Codex must report the conflict and wait for Gawain merge-order direction.

## Branch Naming Convention

Use:

```text
<lane-type>/<short-slice-name>
```

Examples:

- `docs/parallel-ai-execution-lanes`
- `runtime/operator-review-artifact-preview`
- `ui/operator-review-readonly-panel`
- `contracts/merlin-route-packet-guard`
- `mealscout/menu-evidence-contract`
- `tradescout/contractor-intake-routing`

Branch names must be lowercase, short, and lane-specific.

## Lane-Specific Allowed Files

Codex must list allowed files in the route packet before editing.

If a required file is not listed, Codex must report it before touching it unless it is clearly a direct target needed for validation.

## Lane-Specific Banned Files

Every route packet must declare banned files or directories.

Default banned files for all lanes:

- unrelated brand-lane files
- generated artifacts
- database files
- build output
- unrelated package/config files
- product UI files for docs-only lanes
- runtime source files for docs-only lanes

## Validation Expectations

Normal validation command discovered from this repo:

```text
npm run check
```

Additional validation may be required by lane:

- `npm run test:contracts`
- focused `npx tsx --test --test-concurrency=1 ...`
- Playwright/browser checks for UI lanes
- served-reality verification for production-facing changes

Codex must not claim tests passed unless the exact command ran and passed.

## Return Format

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
