# WIP: driveSync rewrite — unfinished (not shipped)

## Status language
- `src/driveSync.ts` rewrite: **not shipped**
- `src/driveManager.ts` + `docs/OR_PARTNER_OUTLINE.md` from the same WIP stash: **merged** on `main` at `e0e639b` (**live** on `origin/main`)
- Overall claim in `e0e639b` ("keep in-progress rewrite" for `driveSync.ts`): **false** — tree kept the pre-rewrite `driveSync.ts` blob

## Why this branch exists
`e0e639b` commit message said the WIP `driveSync.ts` rewrite was kept over `origin/main`. That was incorrect:

| Path | Claimed | Actual at `e0e639b` |
|------|---------|---------------------|
| `src/driveSync.ts` | WIP rewrite kept | Old blob `56d12e53ce963ba962b20579a2a5540f911eb3b1` |
| `src/driveManager.ts` | Applied from stash | Landed (`7b32048b6238cb989d4e8ab653e77a28178e4269`) |
| `docs/OR_PARTNER_OUTLINE.md` | Applied from stash | Landed |

The attempted rewrite lived in `stash@{0}` / untracked backups, not in the tip tree.

## Artifacts on this branch (`wip/drivesync-rewrite/`)
| File | Notes |
|------|--------|
| `driveSync.stash.ts` | Blob `2bd3fce19cf0df453b08159bd24754fce407509a` from `stash@{0}` — **corrupted** (literal `\\n` / truncated final line); not buildable as-is |
| `driveSync.private.ts` / `driveSync.trash.ts` | Same corruption class as stash |
| `driveSync.old.ts` | Coherent older snapshot (`1b78eeae…`); no `planDriveInboxScanTargets` / MealScout intake wiring |
| `driveManager.old.ts` / `driveManager.private.ts` | Pre-merge backups around the manager rewrite |

## Disposition
- Do **not** treat the driveSync rewrite as shipped, merged, or live.
- Prefer repairing from these artifacts on this branch before any future land attempt.
- `main` continues to serve the known-good `driveSync.ts` blob `56d12e53…` until a coherent rewrite lands.
