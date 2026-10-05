# Server Hose adapter

Connects application Effect Streams to Hose channels with the server's public
error policy. Registration and routing belong to `common/hose`.

## Invariants

- This module must never own a router, import a Feed schema, or enumerate
  business operations. Each feature registers its handlers with common Hose.
- `streamChannel` owns one scoped Effect execution per logical channel.
  Its handler is declared without a runtime; dispatch receives `Context` from
  `server/context.ts` and executes through `ctx.runtime`. It parses input once,
  applies shared error policy, and forwards ordered values.
- Teardown aborts Effect execution and its underlying I/O. Closed channels must
  never receive late data, errors, or completion; cleanup is idempotent.
- Parsing, opening, later stream failures, and encoding errors use
  `server/lib/errors` once. Domain handlers do not classify/log transport errors.
- A public error (`failureFor(...).details.error`) ends the channel with
  `failed` and is its `body`. Any other failure ends it with `invalid_request`
  (status BAD_REQUEST) or `internal`, without a body. Wire shape:
  [Hose](../../../common/hose/README.md).
- Common Hose remains unaware of Feed, Dataset, Resource, or snapshot semantics.
