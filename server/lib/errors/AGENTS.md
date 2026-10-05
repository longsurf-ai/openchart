# Server error policy

Owns the public description of server failures across Feed, Access/Billing,
Resource, and transport boundaries. Domain error definitions remain at their
domain owners. Design: [errors](../../../docs/architecture/errors.md).

## Invariants

- `failureFor` is the single classifier. Only known domain errors may expose
  their message and structured details. New public domain failures add a
  mapping here; they do not add catches to handlers or domain checks to
  transport formatters.
- Public errors (an encoded FeedError, a `Tea.Failure`) go at `details.error`;
  tRPC sends it at `data.error`, Hose as the `failed` body. Feed causes are
  logged here once; no cause is ever encoded.
- Status tables are exhaustive over reason tags and reuse tRPC's status
  vocabulary. `code` is a label, never sent by a transport; never branch on it.
- Unknown failures and wiring defects become `internal` and are reported here
  once per failing operation. Their causes stay local.
- Transport wrappers preserve the original cause and mark already-classified
  failures so formatting does not classify or report them twice.
- Native protocol errors retain their status but do not expose raw parser data.
