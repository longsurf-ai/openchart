# control

Framework-agnostic control panel module that manages toolbar state (symbol, resolution, range, series type, grid layout) and broadcasts changes over the event bus.

## Invariants

- Setters on the handle mutate the store **and** publish a bus event; calling `Bus.publish` manually will skip the store update and leave state out of sync.
- `ControlPanelStore.get` throws if the panel ID is missing — use `tryGet` when the panel may not exist yet.
