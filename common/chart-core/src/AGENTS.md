# @openchart/chart-core

Package entry point. Re-exports all public API types, namespaces, and functions from sub-modules.

## Invariants

- Adding a new sub-module requires a corresponding export line here
- The v2 API is re-exported as a namespace (`export * as v2 from "./v2"`), not flattened
- Type-only exports use `export type` to avoid bundling runtime code for pure type re-exports
- Sub-module guidance lives in the nearest `AGENTS.md` only when the directory
  has module-level invariants to preserve
