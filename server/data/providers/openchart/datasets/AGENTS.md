# OpenChart Datasets

Owns native search, pagination and DataFrame adaptation of typed OpenChart results.
`definitions/` reuses pure `contract.ts` schemas. Client owns transport, wire
decoding, unit conversion, response identity and account invalidation.

- Trust decoded client results; never parse JSON/Arrow or encode endpoint queries.
  Pagination validates ordering/ranges; failures never become partial success.
- Preserve half-open bounds and actual-row count semantics. Missing bars stay absent.
  Intersect history with the Unix-epoch lower bound; pre-epoch-only reads return
  empty without sending invalid upstream requests.
- Search returns at most 200 ranked native listings, without full indexing.
  Feed owns class filtering and merged limits.
- Heartbeats prove liveness and never supply prices.
- Calendar caches each listing's Cloud rows for an hour per activation and
  expands them with the local calendar schedule; failed reads are not kept.
