# Upsell

Decides when OpenChart Cloud would help and paces how often its offer appears.
[CloudOfferCard](../../features/billing/components/cloud-offer-card.tsx) renders it.

- Features only report what the user did: `reportUpsell(failure)` for a Feed
  failure they saw, `reportLockedOption` for a chart option the source lacks.
  They never check eligibility or write copy.
- `cloudSolves` and `cloudOffersOption` are the only rules for what Cloud fixes:
  a free source's `HistoryUnavailable` or `RateLimited`, OpenChart
  `AccessDenied`, or a missing interval, session or adjustment. Never
  gate on coverage or promise a symbol; Cloud coverage is operator-managed.
- Chart menus keep such options clickable, muted with a lock; choosing one
  reports instead of changing the chart.
- One offer at a time. After a failure-triggered offer shows, the next failure
  waits `offerCooldownMs`; choosing a locked option asks for the offer and always
  shows it. Only `lastShownAt` persists, device-local.
- Billing owns eligibility (subscription and Cloud access) and the card;
  onboarding and signed-out sessions pause the offer.
