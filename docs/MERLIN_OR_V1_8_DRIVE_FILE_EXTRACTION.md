# Merlin OR v1.8 Supported Drive File Extraction

## Goal

Add deterministic file extraction so Drive imports become searchable context in LISA.

## Supported first-pass extraction

- `text/plain`
- `text/markdown`
- `application/json`
- `text/csv`
- `application/pdf` metadata-only (no OCR)

## Rules

- No OCR.
- No model summarization.
- Extraction is deterministic and local.
- Manual and scheduled sync continue using the same import path.

## Extraction result fields

- `file_id`
- `file_name`
- `mime_type`
- `extracted_text`
- `extracted_fields`
- `extraction_status`
- `extraction_error` (optional)
- `extracted_at`

## Replay lifecycle

- `drive_file_extraction_completed`
- `drive_file_extraction_failed`
- `drive_file_metadata_only`

## Search behavior

Drive manifest search results in LISA now include extraction text snippets in summary, which makes file-content terms discoverable through:

- `GET /api/lisa/search?q=...`
