# Merlin OR API Contract v0.1

## Milestone

**Merlin OR v0.1 accepts TradeScout activity, stores it through LISA, derives entity context, and returns Merlin Daily from current activity instead of fixtures.**

## Transport

- HTTP/JSON
- Base URL: runtime host (e.g. `http://localhost:3030`)
- All payloads are JSON objects.
- Error payloads return:
  - `400` for client errors (`{"error": "<reason>"}`)
  - `404` for unknown route or unknown entity state
  - `500` for server-side failures

## Contract table

### GET `/api/health`

- Purpose: Runtime health check.
- Response: `200`
- Body: health payload (from `src/health.ts`)

Example:

```json
{
  "status": "ok",
  "service": "merlin-or",
  "mode": "read-only-v0"
}
```

### GET `/api/daily`

- Purpose: Read-only Merlin Daily state from LISA, derived from current events.
- Query:
  - `user` (optional): user context id. Defaults to `demo-user`.
  - `limit` (optional): max items per section. Defaults to `20`.
- Response: `200`
- Body: Merlin Daily sections object (all sections required):
  - `changed`
  - `needs_attention`
  - `waiting`
  - `stale`
  - `suggested_next_steps`

### GET `/api/search?q=`

- Purpose: Search LISA timeline with query string.
- Query:
  - `q`: search text
  - `limit` (optional): max results. Defaults to `20`.
- Response: `200`
- Body:
  - `source`: `"lisa"`
  - `query`
  - `results`

### GET `/api/entities/:id/state`

- Purpose: Read LISA-derived current state for one entity.
- Path:
  - `:id` = URL-encoded entity identifier used by TradeScout ingest.
- Response:
  - `200` with entity state object
  - `404` when entity has no timeline events yet

State fields:

- `entity_id`
- `entity_type`
- `brand_lane`
- `current_state` (`needs_attention`, `waiting_for_followup`, `active`, or `monitoring`)
- `truth_score`
- `newness_score`
- `state_age_hours`
- `last_signal_id`
- `source_refs`
- `last_observed_at`
- `attention_required`

### GET `/api/entities/:id/timeline`

- Purpose: Read timeline entries for one entity from LISA.
- Query:
  - `limit` (optional)
- Response: `200`
- Body:
  - `entity_id`
  - `timeline` (array of timeline entries)

Timeline entry fields:

- `id`
- `entity_id`
- `signal_type`
- `observed_at`
- `age_hours`
- `title`
- `summary`
- `source`
- `brand_lane`
- `review_required`
- `truth_score`
- `newness_score`

### GET `/api/changes/recent`

- Purpose: Read most recent LISA-derived change entries.
- Query:
  - `limit` (optional)
- Response: `200`
- Body:
  - `changes` (array of timeline-like entries)
  - `sourceRefs` (unique signal IDs transformed into source references)

### POST `/api/events/tradescout`

- Purpose: Ingest real TradeScout activity into LISA.
- Body: JSON event
  - Required: `entity_id`
  - Optional: `entity_type`, `event_type`, `signal_type`, `observed_at`, `title`, `summary`, `source_reference`, `truth_score`, `newness_score`, `review_required`, `recommended_action`
- Notes:
  - Unknown event types are treated as `contractor_claim`.
  - `entity_id` is the primary lookup key for `/api/entities/:id/...`.
- Response: `200`
- Body:
  - `status: "ok"`
  - `signal_id`
  - `event_id`

Example body:

```json
{
  "entity_id": "contractor-12",
  "entity_type": "contractor",
  "event_type": "contractor_claim",
  "title": "Verification document uploaded",
  "summary": "Customer submitted profile docs.",
  "review_required": false
}
```

Response:

```json
{
  "status": "ok",
  "signal_id": "signal-123",
  "event_id": "signal-123"
}
```
