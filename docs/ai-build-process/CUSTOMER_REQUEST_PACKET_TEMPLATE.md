# Customer Request Packet Template

This packet captures a non-developer customer request in plain English before Merlin translates it into internal governance.

Use simple business language. Do not require the customer to describe implementation details.

## Customer Request Packet

```yaml
customer_request_packet_id:
created_at_local:
customer:
brand_business:
plain_english_request:
business_pain:
desired_outcome:
user_affected:
current_workaround:
cost_of_not_fixing:
success_signal_kpi:
approval_needed:
risk_level:
what_merlin_believes_the_customer_means:
what_merlin_will_not_do:
customer_facing_status:
internal_route_packet_id:
internal_slice_id:
ledger_event_link:
```

## Field Guidance

### Customer

Name the customer, account, founder, operator, or team that made the request.

### Brand/Business

Name the business or brand lane the request belongs to.

### Plain-English Request

Write what the customer asked for in their own business language.

### Business Pain

State the problem causing lost time, confusion, missed revenue, risk, or friction.

### Desired Outcome

Describe what should be better when this is done.

### User Affected

Name who feels the problem: customer, owner, admin, staff, contractor, rep, operator, or another clear role.

### Current Workaround

Describe what the customer does today to get around the problem.

### Cost Of Not Fixing

Explain what gets worse if nothing changes.

### Success Signal/KPI

Name the visible signal or metric that proves the request worked.

### Approval Needed

State whether the customer must approve before work begins, before commit, before deploy, or before launch.

### Risk Level

Use plain language: low, medium, high, or blocked.

### What Merlin Believes The Customer Means

Merlin restates the request in clear business terms to confirm intent before routing.

### What Merlin Will Not Do

State non-goals in plain English so the customer knows what is outside this request.

### Customer-Facing Status

Use one of:

- Goal
- Blocked
- Ready
- Needs Approval
- Live
- Verified
- Needs Fix
- Next Best Action

### Internal Route Packet ID

Filled after Merlin creates the internal route packet.

### Internal Slice ID

Filled after the route packet becomes an execution slice.

### Ledger Event Link

Filled after the work is recorded in the Ledger.
