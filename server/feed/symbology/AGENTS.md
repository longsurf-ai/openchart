# Symbology Feed

Owns merged search, its service and business RPC router. Providers own native listing adaptation.

## Invariants

- provisioner.ts adapts Provider-owned bindings by exact Definition identity
  without acquiring resources. symbology.ts
  owns one backend-scoped coordinator across Feed generations. Index jobs and live
  search writes share per-provider locks; local reads never wait for indexing.
- Indexed hits return locally; zero hits or indexed:false searches all available
  sources, requiring success before global ordering/limit. Successful observations
  upsert; only complete index scopes authorize replacement. No source scores:
  `compareSymbolListings` ranks the exact symbol, then symbol and name prefixes.
- router.ts exposes search/index/indexStatus under feed.symbology. It obtains services through
  Feed.get and forwards explicit request cancellation to the runtime. Requests
  use SymbolSearchRequest directly, without a version envelope.
- Shared consumer shapes come from common/feed; no duplicate schema definitions.
- Index acceptance outlives RPC cancellation; shutdown interrupts jobs. Runtime
  status is transient; the read-only Symbology Resource owns persisted listings.
