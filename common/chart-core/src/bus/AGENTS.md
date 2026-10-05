# bus

Global typed publish/subscribe event bus used for decoupled cross-component communication. Events are defined with Zod schemas and validated at publish time.

## Invariants

- `Bus.listeners` is a module-level singleton; call `Bus.clear()` in tests to avoid leaked subscriptions across runs.
- `Bus.publish` throws if the payload fails Zod parsing -- callers must pass schema-conformant data.
- Subscriptions return an `Unsubscribe` function; forgetting to call it causes memory leaks and stale handler invocations.
- Chart annotation hit/hover events carry canonical interaction geometry from
  the canvas renderer. Do not omit fields that downstream chrome needs to
  distinguish compact and expanded annotation placements, including whether
  the renderer sized the placement for an expanded body.
- `ChartEvent.ChartExplainRange` carries the selected Explain mode. Publishers
  must include it when the canvas state knows it; subscribers default omitted
  mode to `thinking` for old payloads.
