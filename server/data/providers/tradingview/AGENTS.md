# TradingView provider

Owns TradingView data and its undocumented protocol. Optional browser sessions
extend anonymous access.

- `client.ts` owns symbol search, the WebSocket handshake, range requests,
  paging and live subscriptions. `protocol.ts` owns socket.io framing, candle
  decoding and its interval/adjustment vocabulary.
- `credential.ts` decodes stored session JSON and reads the signed-in
  profile. A session that cannot be validated is `Dataset.AccessDenied`, never
  anonymous use.
- `datasets/` declares chart candles keyed by `EXCHANGE:SYMBOL` and searchable
  instruments. `feed/` owns capabilities: crypto uses `24h`, others
  `regular`; no `1s` without entitlement. Listings need a venue or
  `EXCHANGE:SYMBOL`.
- History pages from `create_series`/`modify_series` and `request_more_data`,
  and shares proven spans per activation. Never treat an estimated lower bound
  as caller coverage. Empty ranges are empty data, not failures.
- Anonymous/free sessions use `data`; paid plans use `prodata`. Stored
  sessions are validated before sockets open.
- Search expands native futures contracts, preserves exchange prefixes and
  keeps indices/yields without currency; families are never symbols. No indexing.
- One socket serves one history read or live series. Heartbeats keep open
  series alive but never extend pending responses. Retirement ends streams
  normally, then Feed fails `Feed.Reconfigured`; unexpected closes, overflow
  and protocol violations fail.
- Parse socket messages once; trust decoded values.
