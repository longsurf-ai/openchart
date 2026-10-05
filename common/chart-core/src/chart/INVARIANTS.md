# chart

Core chart state, configuration schemas, and pure layout/query helpers that every renderer and UI layer depends on.

## Invariants

- Market identity is `market: ProviderListing` from OpenChart; provider + symbol
  distinguish listings. Never require or fabricate V1 numeric listing IDs.

- `config.ts` has a **side-effect**: importing it calls `ConfigRegistry.register()`, so import order matters when the registry is read eagerly
- `computeLayout` counts only **visible, non-floating** y-axes per pane; forgetting `axis.fixed === false` will mis-size the chart area
- `dataLength` filters series by `xAxisId`; passing `undefined` aggregates across all x-axes, which may overcount in multi-axis layouts
- `annotationDebug` is transient render/debug intent only. It may be injected by local-development UI, but must not become part of persisted chart resources or annotation records.
- `drawings.activeTool` is the sole tool selection, including `agent_session`.
  Chart Explain has no separate activation flag; its mode and range previews
  are transient interaction state.
- `chartExplain.mode` is transient interaction state for the Explain rail's
  `thinking` and `fast` variants. It must travel with canvas range events and
  must not be persisted as chart data.
- `timeDisplayContexts` is a runtime-only renderer projection keyed by visual
  series id. `calendar-period` selects the resolved grid calendar timezone;
  `instant` and missing contexts follow the chart's user-selected `display`
  timezone. It must never be persisted.
- `strategy` is runtime execution state. Strategy scripts own entry and exit
  orders; the chart renderer automatically derives trade markers and
  performance presentation. It must never be persisted.
