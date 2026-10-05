# span

Durable dashboard/listing range selections used by Chart Explain.

## Invariants

- Market identity is `market: ProviderListing` from OpenChart; provider + symbol
  distinguish listings. Never require or fabricate V1 numeric listing IDs.

- A Span owns semantic range geometry and presentation only. Agent session and
  run lifecycle state must never be copied onto the Span.
- A Span belongs to one dashboard and one canonical listing, never to a chart.
