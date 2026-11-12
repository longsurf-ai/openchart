# TradingView provider

Owns TradingView data and its protocol; browser sessions extend anonymous
access.

- `client.ts` owns search, the WebSocket handshake, paging, live subscriptions
  and socket multiplexing. `protocol.ts` owns framing, candle decoding and
  interval/adjustment vocabulary.
- `credential.ts` decodes stored sessions and reads the signed-in profile.
  Unvalidated sessions are `Dataset.AccessDenied`, never anonymous use.
- `datasets/` declares candles and searchable instruments keyed by
  `EXCHANGE:SYMBOL`. `feed/` owns capabilities: crypto uses `24h`, others
  `regular`; no `1s` without entitlement. Listings need a venue.
- History pages from `create_series`/`modify_series` and `request_more_data`.
  Spans older than two days are cached; newer bars can revise and always come
  from the source. Estimated bounds never prove coverage; empty ranges are
  empty data.
- Anonymous/free sessions use `data`, paid plans `prodata`; stored sessions
  validate before sockets open.
- Search expands futures contracts, keeps exchange prefixes and currency-less
  indices/yields; families are never symbols.
- At most three sockets multiplex chart sessions; creation is serialized so a
  load never trips the 429 upgrade burst. The last session closes its socket.
  Heartbeats keep open series alive but never extend pending responses.
  Retirement ends streams normally, then Feed fails `Feed.Reconfigured`;
  unexpected closes, overflow and protocol violations fail.
- Parse messages once; trust decoded values.
