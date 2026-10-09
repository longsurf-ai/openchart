# Local data

Owns local Dataset declarations and Provider implementations for bundled logos
and the local market calendar.

- `market/` owns market declarations; calendar implementation and declaration
  live together under `market/calendar/`.
- `logos/` owns its declaration, bundled assets, Provider and Feed adapter.
- `workspace/` publishes runtime Datasets for Workspace Dataset Resources and
  reads their CSV files; see its guide.
- Definitions perform no I/O. Import the exact declaration for typed access;
  Provider Layers and caller scopes own runtime resources.
- `index.ts` aggregates declarations for explicit server imports. The generic
  Dataset framework never imports these declarations.
