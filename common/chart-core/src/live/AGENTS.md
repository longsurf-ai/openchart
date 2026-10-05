# live

Shared live-data event contracts and resolution bucketing helpers.

## Invariants

- Browser chart clients consume backend-materialized `/hose` data points
  directly. Core must not expose a second client-side pending-bar accumulator or
  render-overlay state machine.
- `Resolution.getBarStart` uses `Intl.DateTimeFormat` for timezone offsets; results depend on the host's ICU data.
- Sub-day resolutions ignore timezones (simple floor division); daily and above are timezone-aware.
