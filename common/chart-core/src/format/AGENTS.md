# format

Locale-aware formatting utilities for numbers, prices, percentages, volumes, and dates/times used throughout the charting library. All formatters respect a global `Locale.Options` configuration that can be overridden at runtime via `Locale.set()`.

## Invariants

- `Locale` holds module-level mutable state (`current`); calling `Locale.set()` affects all subsequent formatting calls globally, so the order of initialization matters.
- Timestamps passed as `number` are treated as **Unix seconds** (multiplied by 1000 for `Date`), not milliseconds.
- `compact` and `volume` are similar but differ in precision logic: `compact` uses 1-2 decimals depending on magnitude, while `volume` always uses exactly 1 decimal.
- Custom `priceFormatter` and `percentFormatter` in `Options` bypass the locale-aware path entirely.
