# indicator

Owns one chart Indicator per Resource, with its own revision.

- The snapshot plus explicit `parameterOverrides` define the Tea program; Tea
  owns declared defaults. The market stays on the chart cell.
- The snapshot must hold `source.path`. Reload is the only path from the
  Workspace file; `source` only records where the snapshot came from.
- `chart_id` cascades on chart deletion. `cell_id` has no FK because chart
  saves reinsert every cell.
- Chart series bindings name Indicators by value, with no FK. Add/remove
  macros keep bindings and Indicators paired; the chart skips a binding whose
  Indicator is gone.
