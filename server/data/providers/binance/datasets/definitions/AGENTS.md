# Binance declarations

- These files describe Binance-native Spot data and never perform I/O or import Feed implementations.
- `time` uses UTC Unix milliseconds. Count limits actual rows, not elapsed buckets.
- Native symbol identity is not mapped to another provider.
- `trades` is the upstream per-bucket count used to order overlapping REST/WS observations.
