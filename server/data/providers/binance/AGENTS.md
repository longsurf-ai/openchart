# binance Provider

Owns native declarations and I/O in `datasets/`, consumer adaptation and static
bindings in `feed/`, and shared transport in `client.ts`.

- Keep source-specific interval, listing and update rules here. Feed owns shared
  window/countBack composition, routing and search policy.
- `binance.ts` publishes ready Datasets and exports their Feed bindings.
  Adapters match exact Definition identity and acquire no resources at construction.
- Preserve native DataFrame columns and source identities through adaptation.
- `client.ts` owns the hosts: each activation starts on the default and races
  `/api/v3/ping`; a pick that is refused, unreachable or failing hands back to
  the default and races again.
- Provider lifetimes and caller scopes retain their existing cancellation and
  retirement rules. Shared transport/config helpers stay in the parent directory.
