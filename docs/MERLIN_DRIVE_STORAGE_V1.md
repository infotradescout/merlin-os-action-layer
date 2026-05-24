# Merlin Drive Storage v1

## Purpose

Google Drive is the raw storage layer for human-managed, unstructured inputs.

It is **not** the operational database and it is **not** the source of truth for entity state.

Merlin/LISA is responsible for extracting structure, indexing, and producing 4data records.

## Folder structure

Create one top-level Drive folder:

- `Merlin OR Storage`

Recommended subfolders:

1. `00_Inbox`
2. `01_Processed`
3. `02_Needs_Review`
4. `03_Archived_Sources`
5. `04_Entity_Files`
6. `05_Exports`
7. `06_Audit`

## File lifecycle

1. Raw file lands in `00_Inbox`.
2. Merlin ingests by reading file metadata and folder location.
3. A `DriveFileRecord` is created.
4. Supported files are extracted/classified.
5. Useful records create 4data events.
6. File is marked as processed/needs review/archived according to folder target.

## Runtime contract

`DriveFileRecord` shape:

```json
{
  "drive_file_id": "string",
  "file_name": "insurance.pdf",
  "mime_type": "application/pdf",
  "folder_id": "string",
  "folder_path": "Merlin OR Storage/00_Inbox/...",
  "web_url": "string",
  "source_type": "google_drive_file",
  "processing_status": "pending",
  "observed_at": "datetime",
  "processed_at": "datetime",
  "extracted_summary": "string",
  "extracted_fields": {},
  "confidence": 0.82,
  "entity_id": "business_001"
}
```

`DriveSourceMetadata` shape:

```json
{
  "drive_file_id": "string",
  "file_name": "insurance.pdf",
  "mime_type": "application/pdf",
  "folder_id": "string",
  "web_url": "string",
  "source_type": "google_drive_file"
}
```

Folder classification:

- `00_Inbox` => `pending`
- `01_Processed` or `04_Entity_Files` => `processed`
- `02_Needs_Review` => `needs_review`
- `03_Archived_Sources` => `archived`
- Unknown/missing => `inbox`

`shouldCreate4dataEvent`:

- true when file is supported and in processed/archived state.
- false when file is in inbox or needs review.

## Environment configuration

Create a Drive root/inbox folder and set:

- `MERLIN_DRIVE_ROOT_FOLDER_ID`
- `MERLIN_DRIVE_INBOX_FOLDER_ID`

## Scope (v1)

- No API/OAuth calls yet.
- No new endpoints.
- Pure in-memory/in-process conversion and classification only.
- Later step: add Google Drive polling/webhook and persistence for records.
