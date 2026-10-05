# billing

Local client for cloud billing and referrals. `billing.ts` owns the public
contract; `layer.ts` owns HTTP and `router.ts` exposes current-account operations.

- Stripe owns subscriptions; Cloud owns identity, customer binding and prices.
  Preserve plan IDs and UTC ISO timestamps.
- Integration supplies the current `openchart-cloud` key per request. Never
  depend on Auth, read Credential directly, cache keys or persist billing state.
- Credential acquisition and HTTP share one deadline. Recheck the current key
  before returning results; missing or changed credentials reject old results.
- Run operations through the owning runtime; it manages request fibers. Use
  `HttpClient.withScope` with `Effect.scoped` for HTTP cleanup, including unread
  error bodies. Cancellation, timeout and runtime disposal abort requests.
- Account writes do not cancel Billing requests. No Auth/Events lifecycle dependency.
- Redirects cannot forward credentials. Public errors contain safe reason codes,
  never request headers, hosted links, or provider payloads.
- A failed query never means `none`. Return/focus events trigger a fresh query;
  browser navigation never proves payment success.
- `getAccess` reports complimentary access separately from subscriptions.
  Redemption requires no plan and preserves `none`. Cloud owns three lifetime
  codes, rewards, expiry and retry recovery; store no invitation state locally.
