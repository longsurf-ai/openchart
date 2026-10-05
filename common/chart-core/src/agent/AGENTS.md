# agent

Dependency-light agent contracts that must be shared by core resource schemas
and the agent runtime without importing runtime agent code.

## Invariants

- This directory may define pure schemas and types only. It must not import
  `@openchart/agent`, `@openchart/server`, UI code, or runtime provider code.
- `AgentPromptModel` is the only model-selection contract. Product surfaces,
  persisted feature configuration, and queued runs all carry explicit
  `providerID` and `modelID`; there is no tier, product slug, or rebinding
  layer.
