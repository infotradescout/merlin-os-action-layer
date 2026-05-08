# Stripe Canonical Plan

## Current known issue

Stripe product search returned many duplicate products named:

`MealScout Restaurant Plan - Single Deal (1 deal) - Monthly`

These duplicates should not be used for new payment links until dependencies are reviewed.

## Canonical object families

MealScout should use separate product and metadata structures for each payment type.

### Monthly plan

- Product family: MealScout Monthly Plan.
- Intended price: 25 USD per month.
- Launch status: free until working.
- Status: inactive until final business decision.

### Online ordering fee

- Product family: MealScout Online Ordering Fee.
- Fee: 1 USD.
- Fee payer: customer.
- Processing payer: customer.
- Revenue type: MealScout platform fee.

### Parking booking fee

- Product family: MealScout Parking Booking Fee.
- Fee: 10 USD.
- Fee payer: vendor.
- Processing payer: vendor.
- Host price: pass-through to host.
- Revenue type: MealScout platform fee.

## Required metadata fields

All MealScout Stripe objects should include:

- brand
- payment_type
- fee_type
- fee_payer
- platform_fee_amount
- source_system
- fulfillment_required

Online ordering should also include:

- order_id
- vendor_id
- customer_id when available

Parking booking should also include:

- booking_id
- host_id
- vendor_id
- host_payout_required
- host_price_amount

Monthly plan should also include:

- account_id
- billing_period
- launch_status

## Cleanup rules

Do not archive or deactivate duplicate Stripe objects until checking:

- active payment links,
- active subscriptions,
- invoices,
- customers,
- payment history,
- website/app references,
- and fulfillment logic.

## Safe next step

Build code and schemas to enforce metadata quality before creating new live payment links.