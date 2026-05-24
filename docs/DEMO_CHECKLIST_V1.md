# Demo Checklist — Merlin OR v1.0

This checklist demonstrates one full OR loop in the UI.

## Objective

Show a non-technical partner the closed loop from real event to recommendation, approval, and outcome trace.

## Setup

1. Start the server:
   - `npm install`
   - `npm run dev`
2. Open `http://localhost:3030/` in a browser.

## Demo sequence

1. **Open /**  
   Confirm the Merlin Daily page loads.

2. **Show empty state**  
   Confirm initial Daily sections and approvals/replay panels render.

3. **POST TradeScout event**

   ```bash
   curl -X POST http://localhost:3030/api/events/tradescout \
     -H "Content-Type: application/json" \
     -d '{
       "entity_id": "business_demo_001",
       "event_type": "verification_document_uploaded",
       "origin_surface": "tradescout",
       "observed_at": "2026-05-23T14:49:00.000Z",
       "payload": {
         "document_type": "insurance",
         "status": "needs_review"
       }
     }'
   ```

4. **Refresh Daily**  
   Reload `http://localhost:3030/`.

5. **Show Changed / Needs Attention**  
   Confirm event-derived items appear.

6. **Show pending approval if generated**  
   Confirm the approval panel updates when policy requires approval.

7. **Show replay detail**  
   Select a visible daily/recommendation/replay item and confirm the detail panel shows policy/outcome/replay context.

8. **Complete or dismiss approval**
   - Use `POST /api/approvals/:id/approve`, `POST /api/approvals/:id/dismiss`, or `POST /api/approvals/:id/complete`.
   - Confirm the approval status updates.

9. **Verify outcome/replay update**  
   Confirm replay/audit list shows an outcome-linked event and the detail panel reflects the update.

## End condition

- The loop should now be visibly complete from surfaced suggestion to outcome/audit record.
