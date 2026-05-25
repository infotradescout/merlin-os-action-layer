# Merlin OR v2.0 Internal Actions

## Goal

v2.0 adds the first controlled internal action:

- Mark Drive review file as reviewed

This action is intentionally low-risk and internal-only.

## Endpoint

- `POST /api/drive/review/:drive_file_id/mark-reviewed`

## Behavior

When called, Merlin:

1. Looks up the manifest entry by `drive_file_id`.
2. Allows review completion for `needs_review`, `failed`, or `skipped`.
3. Updates manifest `processing_status` to `processed`.
4. Records an outcome (`manual_done`, `completed`).
5. Records replay/audit event (`drive_file_reviewed`).
6. Removes the item from `GET /api/drive/needs-review`.

## Safety Boundaries

- No file deletion
- No external message sending
- No payment/verification execution
- No OCR/model summarization changes
- Internal state change only

## UI

Drive Review Queue now includes a **Mark reviewed** action for selected review items.
After success, the queue and replay panel refresh to reflect the decision trail.
