# MealScout Money Flows

MealScout has three separate money flows. They must not be collapsed into one generic product.

## 1. Monthly plan

Status: free until the system is working.

Intended real price if used: 25 USD per month.

Previous price: 50 USD per month.

Future option: the monthly plan may be removed entirely.

Rules:

- Do not create or promote a live recurring payment link until monthly billing is confirmed.
- Do not make the operating model depend on monthly revenue while the product is free.
- Keep monthly plan metadata separate from ordering and parking fees.

## 2. Online ordering

Model: pass-through plus customer-paid MealScout fee.

Customer pays:

- Order total.
- Processing.
- 1 USD MealScout fee.

MealScout receives:

- 1 USD platform fee.

Rules:

- Customer-paid processing must not reduce MealScout margin.
- The 1 USD fee must be clear in reporting.
- Online ordering should use metadata that identifies order, customer, vendor, and fee type.

## 3. Food truck parking bookings

Model: pass-through to host plus vendor-paid MealScout fee.

Vendor pays:

- Host parking/booking price.
- Processing and applicable fees.
- 10 USD MealScout fee added on top.

Host receives:

- Host-set parking/booking amount.

MealScout receives:

- 10 USD platform fee.

Rules:

- The host must not absorb the 10 USD MealScout fee when the vendor is supposed to pay it.
- Host pass-through funds and MealScout platform revenue must stay distinguishable.
- Parking booking metadata must include host payout context.

## Product separation

Recommended product families:

1. MealScout Monthly Plan.
2. MealScout Online Ordering Fee.
3. MealScout Parking Booking Fee.

Do not use duplicate MealScout Restaurant Plan products for all flows.