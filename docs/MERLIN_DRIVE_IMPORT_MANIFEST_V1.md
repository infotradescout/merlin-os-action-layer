# Merlin Drive Import Manifest v1

## Why this exists

Google Drive is treated as raw input storage.  
The manifest prevents raw files from becoming a hidden black box.

It provides an auditable bridge between:

- Files detected in Drive
- File processing state
- 4data/orchestration decisions
- OR records created from useful files

## Manifest lifecycle

1. **seen**  
   A file appears in Drive and is recognized by ingestion.

2. **pending**  
   File is inbox/new and waiting for processing policy decision.

3. **processed**  
   File was mapped and can create/update OR records.

4. **needs_review**  
   File is supported but ambiguous (entity, context, or confidence gap).

5. **skipped**  
   File is intentionally ignored (unsupported/duplicate/policy skip).

6. **archived**  
   File moved to archive source storage; retained for provenance.

7. **failed**  
   File could not be processed due to an ingestion error.

## Record shape

`DriveImportManifestEntry`:

```ts
{
  id: string;
  drive_file_id: string;
  file_name: string;
  mime_type: string;
  folder_path: string;
  processing_status: 'seen' | 'pending' | 'processed' | 'skipped' | 'needs_review' | 'archived' | 'failed';
  entity_id?: string;
  source_record_id?: string;
  created_4data_event_id?: string;
  seen_at: string;
  processed_at?: string;
  review_reason?: string;
  notes?: string;
}
```

## How manifest connects to OR

- A file is converted to `DriveFileRecord` using `src/driveIngest.ts`.
- Manifest entry is created from that record.
- If `shouldCreate4dataEvent(fileRecord)` is true, Merlin creates structured records.
- Manifest stores:
  - which file produced the 4data event (`created_4data_event_id`)
  - what source entity/file metadata was linked (`source_record_id`)
  - final outcome/status for audit and reruns.

## Helper operations

- `createManifestEntry(fileRecord)`
- `markManifestProcessed(id, updates)`
- `markManifestNeedsReview(id, reason)`
- `markManifestSkipped(id, reason)`
- `markManifestFailed(id, reason)`
- `getManifestEntryByDriveFileId(drive_file_id)`
- `getManifestEntriesByStatus(status)`
- `getRecentManifestEntries(limit)`
- `resetDriveManifestForTest()`

## Scope (v1)

- No Google OAuth in this milestone.
- No Drive API calls in this milestone.
- No endpoint changes.
- Pure runtime helpers only for deterministic behavior and tests.
