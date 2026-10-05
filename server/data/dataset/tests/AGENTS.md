# Dataset test fixtures

Shared declarations for Dataset unit tests and server transport tests.

## Invariants

- Tests explicitly import `@openchart/server/data/dataset/tests/fixtures` to register fixtures.
- Production entry points never import or re-export this module. Importing
  `@openchart/server/data/dataset` must not register `test.echo` or `test.bars`.
- Fixture declarations add no production Dataset contracts or Provider
  implementations; they do not augment a runtime Catalog.
