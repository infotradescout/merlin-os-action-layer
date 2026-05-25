# Merlin OR Crawlability Inputs (v1.3)

## Why crawlability is a safe OR input

Bot crawlability is public-surface readiness, not private product behavior.

It provides deterministic, low-risk context for Merlin about:

- discovery readiness
- SEO health
- LLM and crawler accessibility
- broken routes
- metadata quality
- structured-data reliability
- page indexability

This is safe because it does not execute user actions and does not rely on private
user flow state.

## What it tracks

- Crawl check health and outcomes
- robots directives
- sitemap presence
- canonical metadata status
- page metadata and Open Graph validity
- structured data status
- HTTP status and indexability signals
- LLM crawl readiness / blocking signals

Supported events are:

- `crawl_check_completed`
- `crawl_check_failed`
- `robots_allowed`
- `robots_blocked`
- `sitemap_discovered`
- `sitemap_missing`
- `canonical_valid`
- `canonical_missing`
- `metadata_valid`
- `metadata_missing`
- `og_valid`
- `og_missing`
- `structured_data_valid`
- `structured_data_invalid`
- `http_status_changed`
- `page_indexable`
- `page_not_indexable`
- `llm_crawl_ready`
- `llm_crawl_blocked`
- `stale_crawl_check`

## Daily mapping

- `crawl_check_completed` with healthy payload → `changed`
- `crawl_check_completed` with crawlability failures in payload → `needs_attention`
- `robots_blocked` → `needs_attention`
- `sitemap_missing` → `needs_attention`
- `canonical_missing` → `needs_attention`
- `metadata_missing` → `needs_attention`
- `structured_data_invalid` → `needs_attention`
- `http_status_changed` → `needs_attention`
- `page_not_indexable` → `needs_attention`
- `llm_crawl_blocked` → `needs_attention`
- `stale_crawl_check` → `stale`

## Runtime flow

1. A crawler/worker posts crawlability records to:
   - `POST /api/events/crawlability`
2. `lisa.ts` normalizes the event type into existing signal types.
3. The event passes through the same pipeline as other sources:
   - source registry
   - freshness scoring
   - entity resolution
   - state update
   - timeline append
   - recent changes
   - daily sectioning
   - recommendation policy hooks
   - replay/audit logging

## Entity ID handling

When `entity_id` is not supplied, event ingestion derives one from the provided
`url` using deterministic normalization in `normalizeUrlEntityId(url)`.

Example:

- `https://tradescout.app/p/business/123`
- → `url_https_tradescout.app/p/business/123`

## Future crawler plan

The connector intentionally stops at ingestion for v1.3.

Next steps:

- add a crawler worker in a future patch
- post periodic events from public page checks
- broaden supported signals for additional URL families and surfaces

This keeps Merlin honest: first a controlled input, then broader automation.
