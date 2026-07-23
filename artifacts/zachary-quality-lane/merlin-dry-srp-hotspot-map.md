# Merlin DRY/SRP Hotspot Map

Repo: `Merlin / merlin-os-action-layer`
Branch: `mealscout-screenshot-profile-completion`
Baseline SHA: `798dab5f22b05ee9946eb93825b230ec6e65064e`

Verdict: `REFRACTOR_NOT_STARTED_PARITY_EVIDENCE_REQUIRED`

## Summary

| Signal | Count |
| --- | ---: |
| Raw `fetch()` calls in `src`, `public`, `scripts` | 6 |
| Raw `fetch()` calls in tests | 52 |
| `try/catch` blocks in `src`, `public`, `scripts` | 105 |
| `try/catch` blocks in tests | 23 |
| Largest file | `src/server.ts` |
| Largest file line count | 4597 |

## Hotspots

| File | Lines | Risk | Why it matters | Safe next step |
| --- | ---: | --- | --- | --- |
| `src/server.ts` | 4597 | critical SRP hotspot | Large route aggregator with repeated parsing, response shaping, dispatch, and error handling. | Add route-group parity tests before extracting shared route response/error helpers. |
| `public/mealscout-review-queue.html` | 1289 | high operator UI hotspot | Static UI mixes markup, state, event behavior, local review state, and API calls. | Inventory real-user states and add browser coverage before extracting client helpers. |
| `src/lisa.ts` | 1555 | high mixed-responsibility hotspot | Core file likely combines data access, coordination, and transformation responsibilities. | Map exports and add characterization tests before splitting. |
| `src/merlin/affiliateScreenshotFolderProcessing.ts` | 1053 | high flow orchestration hotspot | Drive discovery, affiliate attribution, screenshot selection, and handoff output concerns are concentrated. | Separate preflight, selection, attribution, and rendering only after behavior tests are pinned. |
| `scripts/screenshots-manifest-move-and-seed.ts` | 956 | high script orchestration hotspot | Drive movement, copy/diagnose/execute modes, reporting, and artifact writing share one script. | Extract artifact IO and mode planning helpers after contract tests cover each mode. |
| `src/merlin/intake/actionCardQueue.ts` | 851 | high persistence and queue hotspot | Queue persistence, action card state, decisions, reload behavior, and JSON persistence logic are dense. | Create storage adapter parity tests before extracting persistence utilities. |
| `src/merlin/intake/reviewPackets.ts` | 833 | medium packet builder hotspot | Review packet construction is large enough to hide repeated formatting and validation concerns. | Add golden packet tests before splitting builder helpers. |
| `public/index.html` | 762 | medium operator UI hotspot | Inline operator UI behavior and state handling should be audited before shared helper extraction. | Add browser state inventory for loading, empty, error, success, and responsive states. |
| `src/roundtableDiscord.ts` | 567 | medium bridge boundary hotspot | Discord payload, signature/allowlist checks, and record-writing concerns share a bridge module. | Keep behavior pinned by existing tests and split only bridge-internal helpers. |

## Duplicated Patterns

| Pattern | Evidence | Risk | Refactor prerequisite |
| --- | --- | --- | --- |
| Artifact JSON/markdown writing | MealScout packet, review queue, clean sweep, approved export, and Drive inventory scripts | Inconsistent summary, safety flag, and markdown rendering behavior across artifacts. | Golden-file or schema tests for each generated artifact. |
| Route `try/catch` response shaping | `src/server.ts`, Merlin route modules | Inconsistent status codes, error names, and `mutationAllowed` envelopes. | Route parity tests for success, validation, missing record, auth block, and unexpected exception. |
| Browser loading/error/success handling | public review/operator pages | Operator pages may diverge in user-facing failure behavior. | Playwright or browser-state screenshots for each public operator surface. |
| Test request helpers | 52 raw `fetch()` calls in tests | Test harness behavior can drift and hide inconsistent API envelopes. | Shared test client with no assertion changes. |

## Do Not Refactor Yet

- Do not split `src/server.ts` before route parity coverage is explicit.
- Do not extract public UI helpers before a real-user state inventory exists.
- Do not alter approved export, publish execution, or mutation gates in a cleanup pass.
- Do not collapse screenshot artifact scripts until generated artifact snapshots are covered.
