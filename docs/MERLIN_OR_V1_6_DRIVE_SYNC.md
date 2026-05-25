# Merlin OR v1.6 Dedicated Google Drive Manual Sync

## Goal

v1.6 adds the first runtime path from a dedicated Google Drive into Merlin through a **manual sync** flow.  
No scheduled poller is added yet.

## Environments

- `MERLIN_DRIVE_MODE` (`oauth` | `service_account` | `manual`)
- `MERLIN_DRIVE_SYNC_ENABLED` (`true` | `false`)
- `MERLIN_DRIVE_ROOT_MODE` (`dedicated_drive`)
- `MERLIN_DRIVE_ROOT_FOLDER_NAME` (default: `Merlin OR Storage`)
- `MERLIN_DRIVE_SYNC_MODE` (`manual` | `scheduled`)
- OAuth credentials:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI`
  - `GOOGLE_REFRESH_TOKEN`

## New behavior

- Add a Drive auth/config layer (`src/driveAuth.ts`).
- Add a Google Drive client abstraction (`src/driveClient.ts`) with:
  - `getDriveClient`
  - `listFilesInFolder`
  - `getFileMetadata`
  - `downloadFileContent`
  - `moveFileToFolder`
  - `findFolderByName`
  - `createFolderIfMissing`
- Add sync orchestration (`src/driveSync.ts`) with:
  - `discoverManagedFolders`
  - `syncDriveInbox`
  - `importDriveFile`
  - `routeImportedFile`
- Add endpoints:
  - `POST /api/drive/sync`
  - `GET /api/drive/status`

## Sync flow

1. Discover managed folders (creating missing folders in the selected root/folder context).
2. List `00_Inbox`.
3. Skip files already in manifest.
4. Create manifest entry for each new file.
5. Route using sync heuristics:
   - processed supportable files are ingested as `drive_file_imported`.
   - uncertain files go to needs-review/needs-processing buckets.
   - unsupported ones are marked skipped/needs review.
6. Move files into managed folders (`01_Processed` / `02_Needs_Review`).
7. Emit replay events for each import lifecycle state.

## Replay/audit

Existing Drive replay event types are reused:

- `drive_import_received`
- `drive_import_processed`
- `drive_import_skipped`
- `drive_import_needs_review`
- `drive_import_failed`

## Non-goals for v1.6

- No scheduled polling yet.
- No production OCR/text extraction.
- No external source actions.
- No UI changes unless needed for existing pages.

