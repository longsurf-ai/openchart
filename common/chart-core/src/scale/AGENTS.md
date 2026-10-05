# scale

Coordinate-system primitives that convert between data values and pixel positions for both axes, plus axis rendering and interactive scale controls.

## Invariants

- `YScale.State` and `TimeScale.State` are plain Zod-parsed objects, not reactive stores; wrap them in a framework store before passing to renderers
- `visibleRange` returns both a raw `range` (can be negative) and a clamped `valid` range; use `valid` for painting and `range` for scroll math
- `config.ts` self-registers `YAxisConfig` and `XAxisConfig` with `ConfigRegistry` on import, so importing the module has a side effect
- `TimeAxis.generateMarks` infers bar interval from data (min delta of first 50 bars) to route to the correct label branch; this prevents intraday resolutions (15m, 50m) from being mis-routed to day/month branches when the visible time span is large. Calendar-period thresholds must tolerate 23h/25h daily and 167h/169h weekly UTC deltas across DST.
- Time-axis date extraction and crosshair formatting must honor every valid IANA
  timezone, including DST. Named timezones must never fall through to UTC.
