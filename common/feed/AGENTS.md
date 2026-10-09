# Feed contracts

Browser-safe Effect Schema contracts; common/market owns market vocabulary.

- Derive types from schemas. No Zod, Effect runtime, Dataset/provider code,
  credentials, or React. Server and browser decode the same schemas.
- Listings stay provider-scoped; never map across providers. Build a
  BarsSeries with `barsSeries(listing, settings)`. `ticker.ts` alone owns
  ticker ids (`provider:symbol`).
- BarsRequest requires from/to/countBack; countBack is a minimum. Numeric to
  is exclusive; now adds updates. Reject unknown fields.
- Snapshots keep native DataFrame columns, labels and gaps via
  dataFrameCodec; consumers read market `BarColumns`, never Bar rows. Prove
  more history from an excluded observation, never short pages.
- Times are epoch ms. The server resolves the cutoff once; each Hose channel
  sends its snapshot before updates; Hose done is intentional completion.
- FeedVersion keys invalidation and caches; requests carry no version.
- `SeriesRequest`/`SeriesSnapshot` read a declared timeseries by source id,
  `[from, to)`, as a native DataFrame through the shared codec.
- Public errors are Schema classes: `FeedError { reason }`, a closed `Feed.*`
  reason union carrying only facts the caller cannot know. Decode them; never
  branch on string codes, only `_tag`. `isRetryable` lives on the reason.
- Failure wording lives only in `describeFailure`. Upstream text is never
  encoded; server causes stay on the server.
