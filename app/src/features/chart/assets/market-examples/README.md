# Historical market examples

These bundled daily OHLCV observations come from the source providers, not a
synthetic series. The 50 captures cover 25 stocks, ETFs and crypto pairs in
2022 and 2024; the preceding year supplies calculation warmup. Market gaps
remain gaps. The data is deliberately fixed, with no runtime
refresh or quote subscription.

From the repository root, run `just indicator-examples` to recapture through the existing
provider clients and symbology adapters. `just indicator-examples --verify`
refetches the same ranges and checks bar hashes without changing the bundle.
Review provider revisions before refreshing.

Rows are `[timeMilliseconds, open, high, low, close, volume]`. Yahoo daily times
are exchange-local midnight, with split-adjusted OHLCV; Binance uses UTC days and
raw values. Each asset records the exact listing, requested and actual bounds,
source request URL, retrieval time and SHA-256 of `JSON.stringify(bars)`.

`study-windows.json` pins six educational scenarios chosen by executing the
actual studies. Its exclusive `endTime` bounds both the price window and Tea
execution; later confirmations cannot leak into a selected historical example.
`just indicator-study-windows --verify` reruns only those six prefixes and
checks their signals. `--write` explicitly rescans the existing 50 captures.
Other studies retain balanced deterministic assignment across the same cache.
