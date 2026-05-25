# Merlin OR v2.3 Drive File Routing

## Goal

Add a safe manual routing action for Drive files after review or entity attachment.

## Endpoint

- `POST /api/drive/review/:drive_file_id/route`

Request body:

```json
{
  "target": "processed | entity_files | archive",
  "entity_id": "business_001",
  "note": "optional"
}
```

## Safety rules

- Manual action only (user click required)
- No deletion
- No routing when Drive is not ready
- No routing when folder setup is blocked/conflicted
- No entity-files routing without `entity_id`
- Canonical folder IDs only

## Routing targets

- `processed` -> `01_Processed`
- `entity_files` -> `04_Entity_Files/<entity_id>`
- `archive` -> `03_Archived_Sources`

## Side effects

On successful route:

1. Drive file moves to target folder.
2. Manifest updates `folder_path` and status.
3. Outcome is recorded (`manual_done`, `completed`).
4. Replay event is recorded (`drive_file_routed`).

## Non-goals

- No auto-routing for ambiguous files
- No OCR/model changes
- No external action execution
