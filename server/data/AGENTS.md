# Server data

Owns Dataset access, the observable Catalog and data Provider composition. See
[data access](../../docs/architecture/data-access.md).

- `dataset/` owns declarations, derived codecs and ready handles. Providers own
  source definitions, configuration, I/O, lifetimes and Feed adapters.
- Access-checked Providers own `checkAccess` and `refresh`; access requirements are
  independent of enabled preferences and ready Dataset availability. Settings uses
  the same checks as activation; failures never mean unsubscribed.
- `providers/index.ts` is the application registration point for Provider Layers
  and their Feed bindings. Feed consumes those bindings without source-specific code.
- Catalog subscribes once per Provider, aggregating ready instance sets. It never
  acquires resources, reads config or disposes instances. Failed watches withdraw
  only their own contribution; unchanged sets preserve snapshot identity.
- Catalog has no `get`: find a Dataset in `list()`/`watch()` by Definition
  identity. Duplicate or undeclared contributions are wiring defects: Catalog
  dies rather than overwrite valid bindings.
- Local Dataset schemas/connections stay outside application migrations.
- Common and browser code consume Feed contracts; they never import this module.
