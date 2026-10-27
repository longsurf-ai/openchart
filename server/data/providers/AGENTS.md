# Data providers

<!-- HUMAN-ANNOTATION:START -->

Each Provider owns all source-specific logic in its directory, never in generic
Dataset or Feed.

`binance/`, `yfinance/`, and `openchart/` use:

- `<provider>.ts`: activation, ready Datasets, exported Feed bindings.
- `datasets/definitions/`: I/O-free declarations; `datasets/`: native access.
- `feed/`: consumer adapters; `feed/feed.ts`: exact-Definition bindings.
- `client.ts`, `config.ts`, `errors.ts`: transport, configuration, failures.

`local/market/calendar/` owns its bundled declaration and implementation.

Provider-specific intervals, identities, capabilities, pagination, polling,
liveness, finality, stitching, and renewal stay in its directory.
The parent owns shared lifecycle/HTTP helpers and registration; generic Feed
owns routing, search policy, and history-window/countBack composition.

<!-- HUMAN-ANNOTATION:END -->

- `tradingview/` follows the same layout.
- `configured.ts` owns activation: retire admission before replacement, drain
  accepted work, cancel stale acquisition, retry failures (never defects).
  Watchers stay active; retirement never reaches Catalog/Feed.
- Fail with `DatasetFailure(reason, { cause })`; upstream text belongs in
  `cause`. Wiring errors are defects.
- Requests own resources; streams use caller Scope. Cancellation aborts I/O.
- Report Monitoring health; never infer freshness from `asOf`.
- Subscribe before snapshots; bound buffers; gaps require resynchronization.
- `http.ts` owns cancellation, concurrency, Retry-After; quotas survive
  reactivation. Parse responses once; paginate to exhaustion.
- Never fabricate OHLCV; omit empty slots, reject partial bars.
