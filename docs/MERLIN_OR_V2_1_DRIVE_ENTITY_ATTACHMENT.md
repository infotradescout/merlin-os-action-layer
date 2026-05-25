# Merlin OR v2.1 Drive Entity Attachment

## Goal

Add a manual-only internal action to attach a Drive file to an entity.

This turns reviewed files into usable OR context without automatic matching.

## Endpoint

- `POST /api/drive/review/:drive_file_id/attach-entity`

Request body:

```json
{
  "entity_id": "business_001",
  "entity_type": "business",
  "note": "Insurance document for business profile"
}
```

## Behavior

1. Find manifest entry by `drive_file_id`.
2. Return `404` if missing.
3. Require `entity_id` (`400` if missing).
4. Update manifest with `entity_id` and optional `entity_type`.
5. Move internal status to `processed` so it leaves needs-review.
6. Emit a Drive attachment event into LISA for timeline/state continuity.
7. Record outcome (`manual_done`, `completed`).
8. Record replay event (`drive_file_attached_to_entity`).

## Safety Boundaries

- Manual attachment only.
- No auto-attachment or AI matching.
- No OCR added.
- No model summaries added.
- No external actions.
- No Drive file deletion/move side effects required by this action.

## Why this matters

v2.0 proved internal action logging.
v2.1 makes Drive files useful to entity continuity:

- better LISA search linkage,
- entity timeline traceability,
- replay and outcome coverage for attachment decisions.
