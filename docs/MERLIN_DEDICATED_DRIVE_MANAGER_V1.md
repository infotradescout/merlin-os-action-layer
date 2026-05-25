# Merlin Dedicated Drive Manager v1

This milestone upgrades the Drive foundations from a planned/manual import model into a dedicated Drive manager blueprint.

Merlin now treats Google Drive as:

- raw document storage
- human file inbox
- source archive
- export vault

Merlin/LISA handles:

- file organization policy
- source indexing and records
- LISA search/searchability
- review queue handling
- history via manifest + replay/audit

Merlin does **not** use Drive as the current state engine.

## Dedicated Drive roles

Assumptions for this milestone:

- The connected Drive is dedicated to Merlin OR activity.
- Merlin can create/move/reconcile files inside this managed namespace.
- No production OAuth/runtime client is required in this milestone.

For this reason, Drive APIs are intentionally not yet called and behavior remains API-driven by
`POST /api/drive/import-file`.

## Auth choice

Use OAuth for a dedicated Google account:

- Better fit for "one account owns the workflow".
- Cleaner for "first-class ownership of dedicated account files".

Use service account for Workspace Shared Drive:

- Better fit for managed access boundaries.
- Works naturally in managed shared-drive environments.

## Required managed folders

Merlin manages the following internal folders under a single root:

1. `00_Inbox`
2. `01_Processed`
3. `02_Needs_Review`
4. `03_Archived_Sources`
5. `04_Entity_Files`
6. `05_Exports`
7. `06_Audit`
8. `07_System`

## Filesystem-style planning module

- `src/driveFolders.ts`
  - `getRequiredDriveFolders()`
  - `normalizeDriveFolderName(name)`
  - `buildDriveFolderPlan(existingFolders)`
  - `classifyDriveManagedPath(path)`
- `src/driveManager.ts`
  - `createDriveBootstrapPlan(existingFolders)`
  - `createFileRoutingPlan(fileRecord)`
  - `shouldMoveToProcessed(fileRecord)`
  - `shouldMoveToNeedsReview(fileRecord)`
  - `shouldArchiveOriginal(fileRecord)`
  - `parseDriveManagerConfig(env?)`

All functions are pure and safe for planning/validation.

## Env support

Config support is added through environment variables:

- `MERLIN_DRIVE_MODE=oauth|service_account|manual`
- `MERLIN_DRIVE_SYNC_ENABLED=true|false`
- `MERLIN_DRIVE_ROOT_MODE=dedicated_drive`
- `MERLIN_DRIVE_ROOT_FOLDER_NAME=Merlin OR Storage`
- `MERLIN_DRIVE_SYNC_MODE=manual|scheduled`

Current behavior remains unchanged for runtime endpoints while keeping these values available for manager planning and later runtime integration.

## Lifecycle

1. Planner computes bootstrap needs from existing folders.
2. Existing `POST /api/drive/import-file` accepts Drive metadata.
3. Manifest entries are created and updated.
4. Routing decisions determine:
   - processed
   - needs review
   - skipped
   - pending
5. Processable files produce Drive-related LISA artifacts.
6. Non-processable files become searchable review or archive decisions.
7. Replay records persist the import lifecycle.

## Safety rules

- Do not execute external actions.
- Do not implement OAuth/Drive API calls in this milestone.
- Do not change existing endpoint response shapes.
- Keep Drive file metadata as raw source material.
- Keep current state in LISA/SQLite-backed runtime.
