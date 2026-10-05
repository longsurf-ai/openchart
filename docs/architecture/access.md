# Access

The local backend separates account state, subscriptions, provider connections,
and encrypted credentials. Their composition lives in `server/runtime.ts`;
`server/access/router.ts` mounts the public procedures.

| Owner                        | Responsibility                                                           |
| ---------------------------- | ------------------------------------------------------------------------ |
| `server/access/auth/`        | Account sign-in, restoration, sign-out, and connection cleanup           |
| `server/access/billing/`     | Subscription reads and hosted checkout or portal links                   |
| `server/access/integration/` | Provider registrations, authentication methods, and credential selection |
| `server/access/credential/`  | Encrypted durable credential storage                                     |

The Clerk SDK owns the sign-in interface and browser authentication. Desktop
provides its native bridge. The local account receives the SDK-issued user key
and Clerk key ID through Auth. Restoration matches the user and key ID;
sign-out disables saved credentials and performs connection cleanup within the
same serialized operation.

Integration is Credential's only business caller. Billing and data providers
resolve credentials through Integration; frontend reads and account events
expose metadata only. Integration does not depend on Auth, and Auth does not
import a concrete data provider.

Auth distinguishes signed-in from signed-out state. An operational failure is
an error, not a signed-out result. Billing likewise preserves failed reads as
errors rather than presenting them as an absent subscription. Account changes
invalidate pending results.

Desktop protects the credential encryption key with the operating system's
secure storage. Provider secrets, Clerk secret keys, and signing credentials
never belong in application source or frontend bundles. Checked-in Clerk
publishable keys are public client configuration.

The remote service owns privileged subscription operations. This repository
contains its desktop client and local application backend; it does not deploy
the hosted service.

See [the access ownership rules](../../server/access/AGENTS.md) and
[desktop hosting](desktop.md).
