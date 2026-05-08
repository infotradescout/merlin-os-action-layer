# Brand Lanes

## TradeScout

Audience: contractors and homeowners.

Primary KPI: verified contractor/homeowner connection outcomes.

Allowed action categories:

- Contractor claim intake.
- Homeowner need intake.
- County context review.
- Scout decision card creation.
- Contact routing after intent and decision context.
- Community Builder asset routing.

Forbidden:

- Lead selling.
- Paid ranking.
- Paid visibility.
- Priority routing for money.
- Trading or sports content.
- MealScout food/event workflows.

## MealScout

Audience: food trucks, event hosts, vendors, restaurants, and public food/event customers.

Primary KPIs:

- Events created.
- Hosts onboarded.
- Vendors activated.
- Online ordering working.
- Parking booking working.

Money flows:

- Monthly plan: 25 USD per month, currently free until working, may be removed later.
- Online ordering: customer pays processing plus 1 USD MealScout fee.
- Parking booking: vendor pays host price, all fees, and 10 USD MealScout fee.

Forbidden:

- Contractor/homeowner trust routing.
- Trading or sports workflows.
- Fake hosts, events, vendors, orders, or payments.
- Hidden customer or vendor fees.

## Trader's Corner

Audience: trading and sports users only.

Status: separate lane. Not active unless explicitly selected.

Forbidden in TradeScout and MealScout:

- Trading signals.
- Sports betting flows.
- Bot performance content.
- Any trading or sports asset crossover.

## LISA

Role: Live Indexed Signal Adapter.

Responsibilities:

- Ingest signals.
- Normalize by lane.
- Score truth.
- Score newness.
- Route to the correct brand lane.
- Recommend an action or block execution.

LISA must not mix brand lanes.