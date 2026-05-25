# Merlin OR v2.2 Entity Suggestions

## Goal

Add deterministic entity suggestions for Drive review files.

Merlin suggests likely entity matches. The user still confirms attachment manually.

## Endpoint

- `GET /api/drive/review/:drive_file_id/entity-suggestions`

Response includes suggestion candidates:

- `entity_id`
- `entity_type` (optional)
- `label`
- `confidence`
- `reasons[]`
- `matched_fields[]`

## Deterministic matching inputs

- Drive file name
- extracted text
- extracted fields
- known entity IDs and aliases
- business name
- email
- phone
- domain
- county/location

## Safety rules

- No auto-attachment
- No model-based matching
- No OCR changes
- No external actions

User must still call `POST /api/drive/review/:drive_file_id/attach-entity` to complete attachment.

## Replay

Suggestion generation writes replay events:

- `drive_entity_suggestions_generated`

This keeps suggestion activity auditable without changing attachment behavior.
