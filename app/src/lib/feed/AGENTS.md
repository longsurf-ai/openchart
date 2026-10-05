# Feed client

Promise/Observable access. Only transport/contracts use Effect Schema;
no Effect runtime, Dataset/providers, credentials, or server imports.

- AppTransport owns the shared HoseClient. Client close cancels only its
  requests/channels; versions never close sockets.
- transport.ts owns calls/decoding; bars.ts owns ordering/bounded replay/sharing.
  Shared DataFrames stay immutable with columns, labels, gaps; never rows.
- `feedError()` decodes `FeedError` from tRPC `data.error` or the Hose error
  body; everything else is a ClientFailure from Hose socket/protocol codes.
  Never read server codes or text. Word failures with `describeFailure`; offer
  Retry only through `offersRetry` (version watches always may).
- IBarsFeed.observe shares the newest open live view covering a request,
  kept 5 minutes after its last subscriber so remounts reattach. Replaced,
  failed or finished views aren't reused. Closing a channel stops
  ingestion; retained views replay then end. Overflow fails before dropping.
- useBars switches with switchMap, compares schema-derived content and keeps
  live batches out of React. loadingBehavior keeps/clears without fetching;
  arrived views survive errors, labelled with current.request. Retry uses
  latest input.
- FeedProvider re-reads versions on ready/version events; stale reads never
  publish; failures never unmount consumers or block UI.
- Finite hooks await the first version, then key by version without
  cancelling; requests carry no version precondition.
