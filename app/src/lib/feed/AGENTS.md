# Feed client

Effect Schema owns contracts; data utilities model cache state. No Effect
runtime, providers, credentials, or server imports.

- AppTransport owns HoseClient; client close cancels channels. Versions never close sockets.
- transport.ts owns calls/decoding; bars/ separates ordering, compacted replay, and sharing.
  Shared DataFrames remain immutable, preserving columns, labels, and gaps.
- `feedError()` decodes tRPC `data.error` or Hose bodies as `FeedError`, otherwise
  ClientFailure. Use `describeFailure` and `offersRetry`, never server codes/text.
  Version watches always permit retry.
- IBarsFeed.observe shares the newest covering live view for 5 idle minutes.
  Ended/replaced views aren't reused. Closing stops ingestion;
  retained views replay then end. Replay consolidates revisions by bar for late
  readers; active readers retain live batches. Overflow fails before dropping
  any of the 50,000 distinct updated bars.
- useBars uses switchMap and schema-derived equality; live batches bypass React.
  Loading keeps/clears without fetching; arrived views survive errors with their
  request identity. Retry uses current input with automatic retryable-failure backoff.
  Errors persist until snapshots; request/client changes and unmount cancel retries.
- FeedProvider re-reads versions on ready/version events; stale reads never publish.
  Failures never unmount consumers or block UI.
- Finite hooks await the first version, then key by version without cancellation
  or request preconditions.
