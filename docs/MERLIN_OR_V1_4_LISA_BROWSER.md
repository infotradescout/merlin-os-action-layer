# Merlin OR v1.4 LISA Browser

## What is this

Merlin v1.4 introduces the **LISA Browser** as the coordination-layer view for underlying runtime records.

v1.3 added active input paths (`/api/events/*`).

v1.4 adds read-only browsing and search so partners can inspect where `Merlin Daily` items came from.

## What it does

- Exposes LISA context through dedicated endpoints:
  - `GET /api/lisa/search?q=`
  - `GET /api/lisa/entities`
  - `GET /api/lisa/entities/:id`
  - `GET /api/lisa/events`
  - `GET /api/lisa/sources`
  - `GET /api/lisa/replay`
- Supports MealScout, TradeScout, and crawlability records through the same runtime rows.
- Renders search results by compact type (`event`, `entity`, `timeline`, `recommendation`, `approval`, `outcome`, `replay`, `drive_manifest`).
- Shows compact search/detail metadata for entity timeline and replay/audit linkage.

## Why this exists

Merlin Daily is a coordination output.

LISA Browser is the explainability layer:
- What event records exist
- Which entities they belong to
- Which recommendations/approvals/outcomes/replay events are connected
- Which source paths produced the record

## Supported result types

- `event`: LISA event rows
- `entity`: persisted entity records from `entity_state`
- `timeline`: timeline entries
- `recommendation`: suggestion records
- `approval`: pending/actionable approvals
- `outcome`: outcome records
- `replay`: replay/audit events
- `drive_manifest`: manifest entries for raw Drive file tracking

## API behavior

- Search is read-only and returns compact records with:
  - `id`
  - `type`
  - `title`
  - `summary`
  - `entity_id` (optional)
  - `source_refs`
  - `created_at` and/or `observed_at`
  - `freshness` / `newness_score` when available
- Empty search string returns no results by design.

## Current limitations

- Search currently composes from persisted in-repo records only.
- There is no external auth for browse endpoints.
- Replay detail is surfaced by linked IDs and source refs.

## Next milestone

- Add a richer entity explorer layout (entity search + timeline + recommendations + outcomes + replay in one panel)
- Add export/import of selected browser results for partner review
- Add dedicated API pagination tokens once record volumes grow