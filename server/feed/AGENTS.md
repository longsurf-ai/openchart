# Feed services

Owns Feed composition and availability. See
[Feed architecture](../../docs/architecture/feeds.md).

- Feed consumes Catalog/Events, never Provider config, acquisition, or lifetimes.
  Providers own exact-Definition or owned-identity runtime adapters; businesses
  own services, provisioners, handlers. Matching shapes prove nothing. Businesses
  never import each other. Concrete Provider imports belong in the data registry.
- Root composition commits services and version atomically, then publishes
  feed.version.changed. Feed.get reads once; requests are unversioned. Returned
  services survive replacement; callers own request/session scopes.
- Only relevant Dataset instance-set changes alter version. Provisioners acquire
  no resources; one scoped observer processes Catalog snapshots sequentially.
  Never create per-version Layers or close Provider-owned scopes.
- Failures are `FeedError { reason }`, mapped from Dataset only by
  `datasetFailure`. Wiring defects are logged; the last snapshot stays.
- Reuse common/feed schemas and common/market vocabulary. Feature handlers parse
  input; hosts stay generic. Bars retain original provider/listing identities;
  symbology requires participating searches to succeed before sorting/limiting.
- Snapshot/update handoff preserves buffering and correction order; gaps/overflow
  fail explicitly. Intentional Dataset completion reaches Hose done; failures stay
  failures. Versions invalidate finite caches, never client sockets or sessions.
- Preserve Dataset layouts: Bars.observe snapshots/updates retain all DataFrame
  columns, labels, and gaps; wire framing uses the shared timeseries codec.
