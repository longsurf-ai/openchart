# v2

State-based core API. The consumer owns `Chart.State`; React is one possible
host. The renderer owns runtime caches and paints from that state.

## Invariants

- Consumers access via `v2.createRenderer()`, not direct imports (`export * as v2` at package root)
- For workspace boundaries, see [architecture](../../../../docs/architecture/code-organization.md).
