# tz

Timezone utilities for converting UTC timestamps to named timezones, computing offsets, and managing timezone metadata used across the charting engine.

## Invariants

- `fromUTC` returns a **shifted UTC epoch** (wall-clock seconds in the target zone stored as if they were UTC), not a true instant; do not pass the result back into APIs that expect real UTC
- `offset` is time-dependent (DST); always pass the actual bar timestamp, not a fixed reference
- The `"local"` timezone bypasses `Intl` and uses `Date.getTimezoneOffset()`, so results depend on the host environment's locale
