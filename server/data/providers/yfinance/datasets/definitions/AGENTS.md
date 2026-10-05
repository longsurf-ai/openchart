# Yahoo Finance declarations

- The provider identifier is `yfinance`; the implementation is TypeScript and uses Yahoo endpoints.
- Keep native symbols/exchanges. No cross-provider mapping belongs here.
- OHLCV comes from Yahoo chart columns; quote prices and daily volume never synthesize bars.
- Delayed polling is distinct from venue delay, whose duration is not fabricated.
- Times are Unix milliseconds; count means actual complete OHLCV rows.
- Daily `time` is the exchange-local date start for both history and polling;
  same-day observations replace the whole row. `asOf` is provider observation
  time. Filter ranges and first-trade boundaries using the normalized bar time.
