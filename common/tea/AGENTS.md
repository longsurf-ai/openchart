# Tea contracts

Browser-safe contracts. Vendored Tea owns Node, Module and `ModuleInputs`;
server/tea executes and resolves Workspace IDs; the compiler reads files.

- `NodeConfig` holds inputs, `InputMap`, complete parameters and child trees,
  never IDs/windows. Coverage follows parameter-bound modules, not `Definition.inputs`.
- `ArrowSchemaJson` restores metadata and canonically encodes Arrow JSON;
  compare encoded JSON. Observations use timeseries codecs; never flatten
  structured outputs or add a Tea frame.
- Observe validates root/`nodes` IDs at admission; runs own derived nodes.
  Only dispose releases IDs.
- `declaration` projects `indicator()`; Module owns output names/types.
- `parameters.ts` and `indicator-outputs.ts` share override, chart-output and
  alert-path rules across charts/macros.
- `visuals.ts` classifies nominal types independently of renderer support.
  Lists preserve element semantics and `tea:write`; each attempt replaces its
  complete indexed contribution.
- Scalar visuals may bind to charts. Only numeric/Plot outputs are numeric alert
  inputs; fills, candles and annotations are not. Segment/Zone describe complete
  per-row geometry, never persistent handles.
- `alerts.ts` recognizes nominal `visual.Alert`/`visual.AlertEvent<Payload>`:
  nonempty lists mean fired attempts; payloads remain per occurrence. Alerts
  are never visuals.
- Persistent drawings require descriptions, including pre-window objects;
  handles are insufficient and transport does not expose them. See
  [Tea architecture](../../docs/architecture/tea.md).
