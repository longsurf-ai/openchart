# Upsell

Decides when OpenChart Cloud would help and paces how often its offer appears.
[CloudOfferCard](../../features/billing/components/cloud-offer-card.tsx) renders it.

- Features only report what the user saw: `reportUpsell(failure)`. They never
  check eligibility or write copy.
- `cloudSolves` is the one rule for which failures Cloud removes: a free
  source's `HistoryUnavailable` or `RateLimited`, or OpenChart `AccessDenied`.
  Never gate on asset class or promise a symbol; Cloud coverage is
  operator-managed.
- One offer at a time. Once it shows, whatever the user chooses, the next waits
  `offerCooldownMs`. Only `lastShownAt` persists, device-local.
- Billing owns eligibility (subscription and Cloud access) and the card;
  onboarding and signed-out sessions pause the offer.
- A new moment adds a `reportUpsell` call and, if needed, a `cloudSolves` case.
