# Custom widgets in OpenChart

A custom widget is a React component in a `.widget.tsx` file in a Workspace.
It renders inside a dashboard card and reads OpenChart data through the widget
SDK. A working example, `price-chart.widget.tsx`, sits beside this guide; copy
it into the current Workspace before adapting it.

## File shape

```tsx
import { defineWidget } from "@openchart/widget";

function Hello() {
  return <p style={{ padding: 12 }}>Hello</p>;
}

export default defineWidget({
  kind: "hello",
  title: "Hello",
  Component: Hello,
});
```

- `kind` is the widget's identity: lowercase letters, digits and hyphens,
  starting with a letter, at most 64 characters. `kind` and `title` must be
  string literals; saving reads them without running the file.
- `Component` receives no props and fills the card. Give its root
  `height: "100%"` and handle overflow inside it.

## Imports

A widget file may import only these modules, statically:

- `@openchart/widget`
- `react`
- `react/jsx-runtime`
- `vega-embed`: `embed(element, spec, { actions: false })` renders a Vega or
  Vega-Lite spec. Finalize its result on unmount, and use `width` and `height`
  `"container"` inside a sized parent. `view.data(name, rows).runAsync()`
  replaces a named data source's rows, for example with live bars (see
  `price-chart.widget.tsx` beside this guide).

Other packages, `require`, dynamic `import()` and `/// <reference>` directives
are rejected. Widgets cannot reach the network themselves; read data through
the SDK.

## Styling

Use the SDK's `Button` and `Input`, and inline `style` objects. Tailwind class
names only work when the app itself already uses them, so do not rely on them.
Use the app's theme variables so light and dark themes both work, for example
`var(--foreground)`, `var(--muted-foreground)`, `var(--border)`, `var(--card)`,
`var(--up)`, `var(--down)` and `var(--chart-1)` to `var(--chart-5)`. Canvas
renderers such as Vega need resolved colors: read them with
`getComputedStyle(element).getPropertyValue("--foreground")`. A canvas keeps
the colors it was drawn with, so a theme switch shows once the widget redraws.

## SDK (`@openchart/widget`)

- `defineWidget({ kind, title, Component })`: the default export.
- `useSymbol()`: a widget that shows one listing calls this for the listing the
  user chose with the dashboard's symbol control (top left of the page;
  clicking the widget makes it the control's target). It returns undefined
  until then, so show a short hint: click this widget, then choose a symbol at
  the top left. Never render a symbol picker
  or search of your own. Other controls, such as a timeframe toggle, may live
  inside the widget.
- `useBarsCapabilities(listing)`: a query whose `data` lists the
  `{ resolution, session, adjustment, modes }` options a listing supports.
- `barsSeries(listing, option)`: the series for one of those options.
- `useBars(request)`: one Bars window. `request` is
  `{ ...barsSeries(listing, option), from, to, countBack }`, with epoch
  milliseconds; `to: "now"` keeps receiving live updates. It returns
  `{ status, current, error, retry }`. `current.data` is a DataFrame of rows
  `{ time, open, high, low, close, volume }` (values may be null); iterate it
  with `Array.from(current.data, (row) => …)`. `current.updates` emits later
  frames without re-rendering; combine them with `mergeByTime(previous, update)`
  and redraw. Keep `request` equal across renders (take `from` from
  `useState`), or the stream reopens on every render.
- `useTea(node)`: run a Tea script over market data. A node is
  `{ source, parameters: {}, ...barsInputs(series), requests: {}, from, to,
countBack, warmupBars: standardWarmupBars }`. `source` is inline text,
  `{ entry: "rsi.tea", sources: { "rsi.tea": text } }`, or a Workspace file,
  `{ workspaceId, path }`. It returns `{ status, data, error, retry }`; `data`
  is a DataFrame of the script's outputs. `barsInputs(series)` builds the
  inputs and map for one Bars series, and `standardWarmupBars` is the warmup
  charts use. `useTeaSource(source)` reads a source without running it. See
  `tea.md` for writing Tea.

Hooks release their own subscriptions when the widget unmounts. Clean up only
what your own effects create.

## Save and place

1. Write the file in the current Workspace, then call `save_widget` with its
   Workspace-relative path. Fix any diagnostics and save again.
2. `save_widget` returns `placementKind` (`custom:<kind>`). Read the dashboard
   with `resource_read`, then `resource_mutate` a patch that adds
   `{ id: "wdg_<unique>", kind: placementKind, layout: { x, y, w, h } }` to
   `/widgets`. The grid has 12 columns and a viewport is 24 rows tall; place
   the widget where it doesn't overlap others. Each kind appears at most once
   per dashboard.
3. Saving the same file again updates every placement of that widget. Saving a
   different file with the same `kind` is refused; to move the kind to that
   file, including after renaming or moving it, delete the old
   `custom_widget`, then save again. Changing a file's
   `kind` saves a new widget; delete the old `custom_widget` when it is no
   longer needed.

Removing a placement keeps the widget. Deleting the `custom_widget` Resource
stops it everywhere and keeps its file; its placements show a notice until you
remove them from each dashboard's `widgets` or save the kind again.
