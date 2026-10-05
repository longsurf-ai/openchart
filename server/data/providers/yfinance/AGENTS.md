# yfinance Provider

Owns native declarations and I/O in `datasets/`, consumer adaptation and static
bindings in `feed/`, and shared transport in `client.ts`.

- Keep source-specific interval, listing and update rules here. Feed owns shared
  window/countBack composition, routing and search policy. Yahoo starts weekly
  bars on period1's weekday, so `1wk` reads start on a Monday, 00:00 UTC.
- `yfinance.ts` publishes ready Datasets and exports their Feed bindings.
  Adapters match exact Definition identity and acquire no resources at construction.
- Preserve native DataFrame columns and source identities through adaptation.
- Search reads each symbol's chart, for its currency, once per activation. When
  Yahoo's search returns no quotes, the query is read as an exact symbol instead.
- `errors.ts` maps Yahoo failures to Dataset reasons; Yahoo text stays in
  `cause`. A 400 keeps Yahoo's JSON body as cause because Bars read
  "Data doesn't exist" as an empty window.
- Provider lifetimes and caller scopes retain their existing cancellation and
  retirement rules. Shared transport/config helpers stay in the parent directory.
