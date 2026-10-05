# Access demo

Independent Electron + React Clerk login and Billing demo. See [README](README.md)
and [Access design](../../docs/architecture/access.md).

- Main owns windows, application lifetime and Clerk's native bridge. Interactive
  sessions stay process-local; backend API keys persist.
- `runtime.ts` supervises one utility process; `server.ts` composes the shared
  runtime and SQLite. Await readiness before opening windows. Window closure
  preserves runtime; app exit stops it.
- Renderer hands the SDK key to Auth once. Secrets stay transient, never in
  query results, URLs or logs. Integration alone accesses Credential.
- Keep sandbox/context isolation and disabled Node integration. Preload exposes
  narrow capabilities, never raw IPC or Node APIs.
- Main supplies async safeStorage through the private backend channel. Never
  fall back to plaintext. Development/package names isolate Keychain items;
  temporary user-data directories alone cannot. Config contains public values.
- Billing uses current Integration credentials. Host opens only Stripe HTTPS
  links. Fixed `openchart://billing/return` and focus trigger queries, never
  payment claims. Account changes clear ephemeral UI state.
- Packaged demo registers sign-in/billing protocols; development preserves
  installed handlers. Generated build files stay outside source.
- Smoke tests use synthetic SDK results, real OS storage and an HTTP fixture.
  Clerk login and remote billing require separate live acceptance.
