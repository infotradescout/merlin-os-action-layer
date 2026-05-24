# Merlin OR v1.0 Daily UI Milestone

Merlin OR v1.0 makes the closed loop visible through a simple daily command surface.

## What works

- Runtime loop is visible through a web screen.
- Daily sections render from `/api/daily`:
  - Changed
  - Needs attention
  - Waiting
  - Stale
  - Suggested next steps
- Pending approvals render from `/api/approvals`.
- Recent outcomes are visible from replay/audit records tied to recent activity.
- Replay/audit records are visible from `/api/replay/recent`.
- A detail panel shows context for selected items:
  - title
  - summary
  - source refs
  - policy result (if present)
  - linked outcome (if present)
  - related replay events

## Routes

- `GET /`  
  Serves the minimal Merlin Daily HTML UI.
- `GET /api/health`
- `GET /api/daily`
- `GET /api/changes/recent`
- `GET /api/approvals`
- `GET /api/approvals/:id`
- `POST /api/approvals/:id/approve`
- `POST /api/approvals/:id/dismiss`
- `POST /api/approvals/:id/complete`
- `GET /api/replay/recent`
- `POST /api/events/tradescout`

## Manual smoke test

1. Run the runtime: `npm install && npm run dev`.
2. Open `http://localhost:3030/`.
3. Verify Daily page renders and shows section labels for:
   - Changed
   - Needs attention
   - Waiting
   - Stale
   - Suggested next steps
4. Verify approvals and replay panels render (empty state is acceptable initially).
5. Post a TradeScout event to `/api/events/tradescout` (or through your preferred API client).
6. Refresh `http://localhost:3030/`.
7. Confirm:
   - Daily sections update.
   - A related approval appears (when policy requires it).
   - Replay events are visible in the audit panel.
8. Click any listed item and confirm the detail panel populates.

## Known limitations

- No auth.
- No voice.
- No external action execution.
- No production persistence hardening beyond current SQLite-backed runtime store.
- No production TradeScout webhook integration.
- No UI for creating/sending messages from recommendations.

## Next milestone

v1.1 — Demo seed endpoints for reproducible local walkthroughs:

- `POST /api/demo/seed-tradescout-loop`
- `POST /api/demo/reset`

These will keep the loop reproducible for partner and investor demos without manual payload crafting.
