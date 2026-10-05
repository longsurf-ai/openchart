# access

Groups local account/provider access. Runtime composes separate services. See
[access architecture](../../docs/architecture/access.md).

- `router.ts` aggregates child routers under `access`; children own procedures.
- Auth owns account writes/state, delegating storage to Integration and running
  runtime-injected connection cleanup within one serialized, uninterruptible
  operation. Auth imports no concrete data Provider. All account
  callers use Auth. Logout disables
  saved credentials; restoration matches both user and Clerk key ID. The caller
  checks Clerk status and stops submissions after cancellation/logout.
- Billing owns subscription queries and hosted checkout/portal links using
  Integration credentials. Stripe owns subscription facts; trusted cloud code owns privileged calls.
- [Integration](integration/AGENTS.md) owns registrations, credential selection,
  and provider OAuth. [Credential](credential/AGENTS.md) owns durable secrets;
  Integration is its only business caller.
- Credential may import Integration identity schemas, never its implementation
  or Auth. Integration never depends on Auth.
- Auth state contains signed-in/signed-out only. Service faults stay errors,
  never signed-out; failed billing queries never mean no subscription. Account
  changes invalidate pending results. Logout owns account cleanup through Integration.
- Public state/events contain metadata only. Login completion accepts the SDK key
  and Clerk key ID once; saved-key queries return IDs only. Secret resolution
  remains a backend capability. Keep public API declarations separate from
  implementation and transport wiring.
