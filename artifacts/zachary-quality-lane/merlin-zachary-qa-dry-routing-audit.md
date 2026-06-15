# Merlin Zachary QA/DRY Routing Audit

Repo: `Merlin / merlin-os-action-layer`
Branch: `mealscout-screenshot-profile-completion`
Baseline SHA: `08be95027fc4bfa0af7acd8533a440e10b5a84b2`

Verdict: `PASS_FOR_ROUTING_WITH_REPO_LOCAL_SCOPE`

## Scope

This checkpoint switches away from screenshot extraction and treats Zachary work as a Merlin-local quality lane.

No MealScout production apply, publish, menu, schedule, logo, cover, or profile mutation is part of this pass. No RoundTable, Albion, Discord, or live MealScout production code is edited.

## Zachary Named File Check

The specific files from Zachary's original app warning are not present in this repo:

| File | Present in Merlin |
| --- | --- |
| `admin-dashboard.tsx` | no |
| `parking-pass.tsx` | no |
| `shared/schema/legacy.ts` | no |
| `server/storage.ts` | no |

That means the Merlin-safe interpretation is QA evidence tooling, review-surface audit, and repo-local DRY cleanup, not direct fixes to those absent app files.

## Repo-Local Findings

Raw `fetch()` usage:

| Area | Count | Assessment |
| --- | ---: | --- |
| `src`, `public`, `scripts` | 6 | Low production-code count in this repo. |
| `tests` | 52 | Mostly repeated test helpers; useful but lower product risk. |

`try/catch` usage:

| Area | Count | Assessment |
| --- | ---: | --- |
| `src`, `public`, `scripts` | 105 | Worth addressing through shared route and UI error wrappers. |
| `tests` | 23 | Lower-risk cleanup after product behavior is covered. |

Large public review surfaces:

| File | Size | Risk |
| --- | ---: | --- |
| `public/mealscout-review-queue.html` | 69943 bytes | Large static review surface with repeated client-state and error handling logic. |
| `public/index.html` | 34047 bytes | Large operator surface with inline behavior and repeated UI state logic. |
| `public/drive-review-queue.html` | 20806 bytes | Drive review UI has repeated loading/error/success patterns. |
| `public/merlin-operator-review.html` | 18422 bytes | Operator review UI should be included in real-user QA flow inventory. |

Route hotspots:

| File | Repeated pattern | Risk |
| --- | --- | --- |
| `src/server.ts` | 25 `try/catch` blocks | Broad server route file with repeated request error handling. |
| `src/merlin/routes/merlinWorkspaceRoutes.ts` | 4 `try/catch` blocks | Candidate for shared route handler wrapper after `server.ts`. |
| `src/merlin/routes/merlinApprovalRoutes.ts` | 4 `try/catch` blocks | Approval routes should keep mutation-safety errors consistent. |

## Recommended Merlin Slices

1. Create a Merlin QA evidence checklist artifact schema.
2. Inventory public review screens with real-user states: loading, empty, error, success, forms, clickables, responsive layout, console health, permissions, and API failures.
3. Extract a shared route error wrapper for Merlin route modules, starting with behavior-preserving route tests.
4. Normalize browser API helpers in public review clients so loading, empty, error, and success handling are consistent.

## Guardrails

- Do not continue screenshot extraction in this lane.
- Do not create live MealScout profiles.
- Do not publish or apply menus, schedules, logos, covers, or profile fields.
- Do not modify app files that are not present in this repo.
- Do not move Zachary doctrine into RoundTable during this repo-local pass.
