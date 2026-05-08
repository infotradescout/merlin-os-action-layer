# Permission Levels

The action layer uses permission levels to decide what can happen automatically and what requires explicit approval.

## Level 0: Read or inspect only

Allowed:

- Search Drive docs.
- Search Gmail.
- Inspect Calendar events.
- Inspect Stripe objects.
- Inspect Canva folders/designs.
- Inspect GitHub repos.

Not allowed:

- Creating, updating, sending, charging, refunding, deleting, archiving, or inviting.

## Level 1: Safe organization

Allowed:

- Create source-of-truth docs.
- Update operating docs.
- Create audit sheets.
- Create Gmail labels.
- Create Canva folders.
- Add non-external internal notes.

Requires:

- Clear brand lane.
- Clear purpose.

## Level 2: Drafted action

Allowed:

- Draft an email.
- Prepare a Canva design candidate.
- Prepare a payment plan.
- Prepare a GitHub issue body.
- Prepare a calendar plan.

Requires:

- Real context.
- No external send or payment action yet.

## Level 3: Real external action

Allowed only with explicit instruction and real data:

- Send email.
- Create calendar invite with attendees.
- Create Stripe products, prices, or payment links.
- Create GitHub issues or pull requests.
- Generate or edit Canva designs.

Requires:

- Real recipient, object, event, customer, product, or repo.
- Clear output target.
- Fail-safe review.

## Level 4: High-risk action

Examples:

- Refund.
- Cancel subscription.
- Archive or deactivate payment objects.
- Delete calendar events.
- Close support loops with external impact.
- Change production routing rules.

Requires:

- Explicit instruction.
- Verified object ID.
- Brand lane.
- Reason.
- Status report after action.

## Default rule

When uncertain, downgrade the action level and produce a plan or draft instead of executing.