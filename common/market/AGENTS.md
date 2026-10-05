# Market vocabulary

Shared market domain values: provider identity, listings, session types and
trading days. Feed request/response envelopes and Dataset declarations consume
these; this package owns no request, transport, or operation contract.

## Invariants

- Effect Schema only; no Zod, no Effect runtime (Layer, Effect, Stream), no I/O.
- Listing identity is provider-scoped. `ProviderListing` (`{provider, listing}`)
  is the identity consumers pass around; a bare Listing means nothing without
  its ProviderId, and no cross-provider equivalence is encoded here.
- Timestamps are Unix milliseconds. TradingDay sessions are atomic
  (`regular`, `pre`, `post`, `overnight`); `extended` and `24h` are query
  selectors, never stored sessions. Bar queries expose exactly `regular`,
  `extended` (pre + regular + post), and `24h` (all available hours).
- `BarColumns` names the columns every Bars source supplies beside `time`.
  Columns are required, cells may be missing; sources keep native columns too.
- Types derive from schemas (`typeof X.Type`); no parallel hand-written types.
