# Access demo

Independent Electron + React demo for Clerk login and Billing, using the shared
[Access services](../../docs/architecture/access.md).

## Run

Enable Google sign-in, **User API keys**, and the **Native API** in Clerk. Add
`openchart-access://app/` to the Native applications SSO redirect allowlist. Copy
[clerk.example.json](clerk.example.json), fill in the public Publishable Key,
and set `OPENCHART_CLERK_CONFIG` to the file's absolute path. Never put a Clerk
application Secret Key in the desktop configuration.

Without the environment variable, both builds read the same public configuration
under Electron's app-data directory: on macOS,
`~/Library/Application Support/OpenChart Access Demo/clerk.json`.

From the repository root:

```sh
bun install
npm --prefix demo/access run package
open "demo/access/out/OpenChart Access Demo-darwin-arm64/OpenChart Access Demo.app"
```

These commands build and launch the macOS Apple Silicon app bundle. Packaging
registers the URL scheme with macOS so Google login can return to the App; use
the corresponding `darwin-x64` output on Intel. The bundle is ad-hoc signed for
local development, not distribution.

The App displays Clerk's prebuilt SignIn component. Google authorization uses the
system browser and Clerk Electron's return bridge. After login, the SDK creates
a user API key and hands it to Auth; Integration stores the key and public profile
in encrypted SQLite. The App then displays account and subscription details.
Each new key gets a unique name because Clerk rejects duplicate names for the
same user. A failed local save retries with the key already held in memory.

Sign out disables the local credential and signs out the SDK session; it retains
the encrypted key and does not revoke it remotely. The backend exposes
`getSavedKey` / `restoreSignIn` for reusing that key after a Clerk status check.
This demo currently only hands off new keys (including their Clerk ID); frontend
status checking and restoration remain to be wired. Restart restores an active
saved account; an inactive account remains signed out. Renderer reload
and macOS window closure preserve the backend; Cmd+Q cleans up the runtime.
The SDK session is process-local; backend tasks depend only on the persisted key.

Unpackaged development/tests use the name `OpenChart Access Demo Development`,
with separate user data and macOS Keychain storage. The public Clerk configuration
is shared. A temporary SQLite profile alone does not isolate safeStorage's Keychain
item, whose name comes from the application name.

macOS may ask for Keychain permission when moving between unsigned/ad-hoc builds
or when the keychain is locked. Stable code signing is required for consistent
access across updates; this local bundle cannot represent the final signed-app UX.
The demo uses asynchronous safeStorage calls so a prompt does not block the main
thread. Denial fails the save and never falls back to plaintext. Do not delete
existing Keychain items: doing so can make saved credentials unreadable.

```sh
npm --prefix demo/access run build
npm --prefix demo/access run start
just demo access
```

`build` type-checks and emits `dist/`; `start` previews it and `just demo access`
starts the Vite development loop. Use the packaged App for end-to-end browser
login: macOS routes the custom-scheme callback to the registered app bundle.

## Billing

Set public `billingUrl` in the same `clerk.json` to the Sandbox endpoint shown in
`clerk.example.json`; omission reports Billing unavailable. The shared runtime
accepts `billing: {baseUrl}`. Billing resolves the current Integration key for
subscription, Checkout and Portal calls; privileged Clerk/Stripe keys stay in cloud.
The demo selects `openchart` / `month`; the cloud owns the actual price.

Subscribe opens Stripe Checkout in the system browser. Existing subscriptions
also expose Manage subscription for the Stripe Portal. The fixed HTTPS return
page is `https://longsurf.ai/billing/return/`; it opens `openchart://billing/return`.
The packaged demo registers this protocol in addition to `openchart-access`.
Launching the demo therefore makes it the billing callback handler on this
machine. Development builds do not replace the installed handler.

Return, window focus and Refresh subscription query the cloud again. A browser
return never proves payment success. Failed queries remain visible errors, and
scheduled cancellation remains active until the period ends. Billing rechecks the
current key before returning results; account changes clear ephemeral renderer
state. The host opens only HTTPS URLs on `checkout.stripe.com` and `billing.stripe.com`.

## Ownership

```text
Clerk UI / Electron SDK -> user API key
                                |
React -> tRPC / SSE -> Auth -> Integration -> Credential -> encrypted SQLite
                                                |
                       private host channel -> Electron safeStorage
```

- `src/main/index.ts`: window, Clerk native bridge, application lifetime and isolation.
- `src/main/runtime.ts`: supervises one backend utility process.
- `src/main/server.ts`: composes the shared OpenChart runtime and local HTTP endpoint.
- `src/main/host*.ts`: private native capabilities for the backend.
- `src/preload/index.ts`: narrow platform/SDK bridge and public backend URL.
- `src/renderer/`: Clerk UI, key handoff, account queries and SSE invalidation.
- `server/access/billing`: HTTP client, typed failures and current-account tRPC routes.
- `server/access/auth`: local account lifecycle and public profile.
- `server/access/integration/openchart-cloud.ts`: first-party API key registration.

The key briefly passes through the renderer at creation; it is not stored in
query results, ordinary config, or logs. Integration alone accesses Credential;
key and profile are encrypted together. Encryption failure cannot report a
successful login or fall back to plaintext. Backend credential reads neither
contact the renderer nor refresh a Clerk session.

The demo uses its own profile and `demo.sqlite3`, separate from the product
prototype. Data-provider wiring and product App integration remain separate work. The Claude SDK and `ws` stay external for the runtime's native
package layout. This entry mounts tRPC, not Hose.

Clerk Electron 0.0.42 needs a small [dependency patch](../../patches/README.md#clerk-electron-api-key-authentication)
to preserve API key requests' session authentication. Main adapts native request
and response headers only for the configured Clerk host and local renderer;
Electron web security remains enabled. Recheck these adapters on SDK upgrades.

## Verification

```sh
npm --prefix demo/access run smoke
```

The smoke test launches real Electron with temporary data and submits a synthetic
SDK result through the real local Auth API. It blocks Clerk networking and verifies
profile display, safeStorage, encrypted key/profile persistence, renderer closure,
restart, local logout, origin rejection, and process cleanup. A local HTTP fixture
also verifies Checkout/Portal opening, return/focus refresh, cancellation display,
and rejection of arbitrary browser destinations. It does not exercise Clerk UI, Google login, or remote API key
verification; those require a separate live smoke. A graphical desktop and
OS-backed credential encryption are required. Shared Auth tests cover storage
failure and logout during an in-flight save.

### Sandbox acceptance (2026-09-15)

Using the local Billing service with real Integration/SQLite and the deployed
Sandbox Lambda, two fresh Clerk test users verified: `none`, reused Checkout,
Stripe test-card payment to `active`, duplicate Checkout rejection, Portal
cancellation at period end, account isolation, and rejection of a revoked key.
The browser reached the published HTTPS return page after payment. Test users,
keys and Stripe resources were cleaned up after verification.

The packaged macOS demo separately restored the existing account and queried
its real cloud subscription. Opening the HTTPS page's app link through Chrome
launched the demo and visibly triggered Refreshing. The deterministic Electron
smoke covers closing/reopening the window and account-state cleanup.
These checks exercise the independent demo; product paywall/Settings integration
remains workflow 4.
