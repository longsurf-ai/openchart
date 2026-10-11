# Feed client

Promise/Observable access. Only transport/contracts use Effect Schema;
no Effect runtime, Dataset/providers, credentials, or server imports.

- AppTransport owns HoseClient. Client close cancels its requests/channels;
  versions never close sockets.
- transport.ts owns calls/decoding; bars.ts owns ordering/bounded replay/sharing.
  Shared DataFrames stay immutable with columns, labels, gaps; never rows.
- `feedError()` decodes tRPC `data.error` or Hose bodies as `FeedError`;
  otherwise use ClientFailure. Never read server codes/text. Use `describeFailure`;
  Offer Retry through `offersRetry` (version watches always may).
- IBarsFeed.observe shares the newest covering live view,
  retained 5 minutes after its last subscriber. Replaced,
  failed or finished views aren't reused. Closing a channel stops
  ingestion; retained views replay then end. Overflow fails before dropping.
- useBars switches with switchMap, compares schema-derived content and keeps
  live batches out of React. loadingBehavior keeps/clears without fetching;
  arrived views survive errors, labelled with current.request. Retry uses
  latest input. Retryable live failures back off automatically; retain their
  error until a valid snapshot. Request/client changes and unmount cancel retries.
- FeedProvider re-reads versions on ready/version events; stale reads never
  publish; failures never unmount consumers or block UI.
- Finite hooks await the first version, then key by version without
  cancelling; requests carry no version precondition.
