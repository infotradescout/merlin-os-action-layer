# Runtime Bootstrap v0

## Goal

Turn Merlin from a documentation and schema repository into a running OR runtime.

## Current runtime files

- src/constants.ts
- src/health.ts
- src/daily.ts
- src/search.ts
- src/main.ts

## Current runtime mode

Read-only v0.

The runtime currently uses fixture payloads instead of live LISA retrieval.

## Current capabilities

- health payload
- Merlin Daily payload
- search payload
- runtime bootstrap entrypoint

## Next milestone

Add a minimal HTTP server exposing:

- GET /api/health
- GET /api/daily
- GET /api/search?q=

## After that

Replace fixture payloads with LISA-backed retrieval.

## Runtime direction

Merlin v0 should:

- retrieve compact current context,
- show what changed,
- show what matters,
- show stale items,
- suggest next steps,
- and support read-only coordination.

Merlin v0 should not:

- mutate source state,
- execute external actions automatically,
- approve records automatically,
- or become a generic chatbot.

## Product principle

Chat starts from the prompt.

OR starts from what is already happening.
