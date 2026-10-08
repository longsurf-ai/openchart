# Calendar Feed

Owns the consumer Calendar service contract, provider routing and its tRPC
router (`feed.calendar.get`).

## Invariants

- Route by request provider only; a provider without a calendar binding fails
  `Feed.SourceUnavailable`, never another provider's calendar.
- Dataset calendar access is distinct from resolving a consumer listing's venue
  calendar; Provider adapters own that resolution.
