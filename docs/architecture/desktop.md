# Desktop

Native alert sound IDs come from Config's `notifications.sound`. The shared
`common/notification` catalog owns their PCM WAV assets. Desktop packages
these in Resources outside ASAR for macOS `UNNotificationSound` lookup; Vite
bundles the same files for user-initiated previews. `none` means silent delivery,
and `system` uses the OS default. Other platforms retain their system sound.
Delivery needs no renderer window or network audio. Native macOS banner duration
remains an OS preference: Persistent keeps banners visible until dismissed.

`platform/desktop` packages the shared App with Electron and hosts the complete
OpenChart server. It bundles Clerk's public configuration and shows Clerk sign-in until a Clerk
session exists; the shared workspace then opens unless the local account belongs to
another user, while the Cloud key handoff finishes in the background. The
sidebar links to Settings → Profile, which shows read-only Clerk identity and
sign-out. Account
operations call [Access](access.md) directly over tRPC; Electron supplies Clerk's
native bridge.

## Layout

`src/` holds the three process entries and their unit tests: `main.ts` (host),
`backend-entry.ts` (server in a utility process), `preload.ts` and
`renderer.tsx` (window), plus `host-protocol.ts` (main ↔ backend messages),
`backend-process.ts` (supervision), `credentials.ts` (credential key),
`assets.ts` (bundled files), and `clerk.ts` (native authentication transport and
SDK session storage). `scripts/tooling.ts` owns
dev/build/package commands, and `tests/smoke.ts` verifies a packaged executable.
`dist/` and `out/` contain generated artifacts; `.artifacts/` holds smoke-test
results.

One `tsconfig.json` covers the host, renderer, tooling and tests. It inherits
the shared OpenChart compiler rules and app aliases from `tsconfig.json`, adding
only DOM libraries, Node/Vite types and local file selection. Editors and
`npm run typecheck` use this same configuration.

## Run and package

Run from the repository root using Node 24 and Bun for dependency installation. The local
workspace includes a public Clerk development key; the workspace requires sign-in.

```sh
just install
just desktop                 # Backend + shared App; renderer Vite HMR
just desktop test-account    # Same, signed in as the shared Clerk test user
just desktop-package development # Complete ASAR app + static renderer; test key
just desktop-build           # dist/, with the live key
just desktop-package         # out/
```

`desktop-build` and `desktop-package` accept `development` or `production`
(default). Both environments use the same build and packaging pipeline;
`development` selects the test Clerk key and development app identity. Only
`just desktop` starts Vite HMR. A complete development package therefore tests
the installed layout and static frontend without production credentials.

`test-account` passes `--openchart-test-account` to Electron; only development
builds honor it. The window then signs in `openchart-dev+clerk_test@longsurf.ai`
with Clerk's fixed test code, and the account gate saves its key as usual.
`just desktop test-account` uses its own `.artifacts/dev-profile-test-account`,
so the developer's own signed-in profile is never involved. The
user must exist in the development Clerk instance with test mode on. Add the
switch to any development Electron launch, such as a throwaway profile for UI
verification. The account cannot reach sandbox data without Tailscale access.

Desktop is the only application host. Interactive debugging and UI verification
use Computer Use in the native window; no standalone browser entry is supported.

On every platform, `just desktop` packages and launches a development app under
`platform/desktop/.artifacts/dev`, retaining Vite HMR. Development and release
share dependency assembly, ASAR layout and the packager entrypoint; neither
launches backend source or bare Electron against the checkout. The development
bundle registers `openchart-dev://app/` so the system browser can return OAuth
results to it. On macOS development uses ad-hoc signing; production uses
Longsurf's Developer ID Application identity and Apple notarization.
On every platform, `just desktop` launches use the checkout-local profile
`platform/desktop/.artifacts/dev-profile` for Electron's single-instance lock
and browser storage. Tooling passes its `home/` subdirectory as application
Home for the database, settings, credentials and workspaces. Different worktrees
can run together; the same worktree remains single-instance.
The profile survives dev rebuilds. Existing shared development data is not copied.
On macOS, `--use-mock-keychain` avoids Keychain prompts in this development-only
profile. Release launches retain their normal profile and OS-protected storage.

The `openchart-dev://` OAuth callback remains a system-wide protocol registration;
worktree profiles do not provide concurrent OAuth callback routing. Keep only the
intended development instance running while completing browser-based sign-in.

### Clerk configuration

`app/.env.development` contains the checked-in public test key for Desktop
development, and `app/.env.production` the checked-in public live key for
releases. Tooling uses Vite's environment loading; an explicit
`VITE_APP_CLERK_PUBLISHABLE_KEY` or `app/.env.production.local` overrides the
files.

Desktop tooling reads the selected environment, validates the key before
building, and embeds it in the main bundle. Production configuration requires
`VITE_APP_CLERK_PUBLISHABLE_KEY=pk_live_...`, which the checked-in file supplies.
Missing keys, secret keys and test keys fail release builds. No per-user `clerk.json` or runtime environment variable is required.
Publishable keys are public; never put a Clerk secret key in these files or bundles.

Desktop selects billing and data endpoints together in `src/cloud.ts`, alongside
Clerk's build environment. Development uses Clerk test, Stripe sandbox and
`https://api.sandbox.longsurf.ai`; production uses Clerk live, Stripe live and
`https://api.alpha.longsurf.ai`. The sandbox API requires the Longsurf Tailscale
network (both Sean and Weilun already have access). `just desktop` needs no local
proxy or server credentials. An active sandbox subscription unlocks the same
shared MarketFeed read path. The host supplies the data endpoint as the default;
an explicit `openchart.baseUrl` in settings.json still overrides it for fixtures.

### Subscription

Settings → Subscription uses the local Billing client. `cloud.ts` owns the
public sandbox/production endpoints, selected alongside Clerk's build environment
and passed to backend startup. Preload exposes only `openBilling` and
`onBillingReturn`; main validates the calling frame and Stripe HTTPS destination.
The fixed return is `openchart://billing/return` for production and
`openchart-dev://billing/return` for development. Early returns are retained until
the renderer subscribes. App navigates to Subscription and queries cloud facts;
window focus also refreshes after manual return from Checkout or Portal.

Development startup failures print to the terminal and exit nonzero. Production
startup failures show an error after Electron is ready.

Enable Native API and user API keys in the Clerk instance. Add
`https://longsurf.ai/auth/return/?app=development` to its native redirect allowlist
for development and `https://longsurf.ai/auth/return/` for releases. The cloud
page forwards Clerk's one-time callback to `openchart-dev://app/` or
`openchart://app/`; the SDK still verifies and completes sign-in. The page relays
Clerk's fields unchanged, including none: Clerk omits the nonce whenever no
session was created, which covers a cancelled authorization and a new Google
account. Any callback settles the pending attempt; Clerk JS then reloads it and
transfers a new account to sign-up, so the page must never invent a failure. The local SDK
patch separates the HTTPS browser return URL from native callback matching.
Disable multi-session support to remove
the Add account action. Branding is controlled by Clerk's instance settings.

Production Google sign-in requires a custom Google OAuth web client in Clerk's
SSO connection settings. Its Google redirect URI is
`https://clerk.longsurf.ai/v1/oauth_callback`; the separate native return URL above
hands the completed Clerk flow back to the app. Keep the OAuth client secret in
Clerk, never in the desktop bundle. An enabled Google button does not prove the
production connection has credentials; test a real sign-in before release.

The host injects `@clerk/electron/react` into the shared App; App components use
`@clerk/react`. Modals stay on the current workspace without a document reload.
Clerk's SDK stores its session using OS encryption. Separately, Access keeps
the encrypted API key in SQLite: login checks a saved key's Clerk metadata and
restores it when valid, otherwise creates one. Query caches only public account
state. Either Sign in entry completes the local credential handoff after Clerk
sign-in. The Profile page's sign-out action stops pending login work, calls
Access logout, then Clerk sign-out. A retained Clerk session never automatically
reactivates a locally disabled key; the user can explicitly sign in again.

On Apple Silicon macOS the package is
`platform/desktop/out/<version>/OpenChart-darwin-arm64/OpenChart.app`.
Development packages are ad-hoc signed for local execution. Hardened runtime
and JIT stay enabled; only development disables library validation because its
ad-hoc identity cannot match Electron's frameworks. Production packages use
`Developer ID Application: Longsurf, Inc.`, notarize through the
`openchart-notary` Keychain profile, and staple Apple's ticket. Packaging targets
the host OS and architecture; public releases initially support Apple Silicon.

### Downloads and updates

Follow the [desktop release runbook](../operations/desktop-release.md) for
signing setup, packaging, acceptance checks, publishing and recovery.

`just desktop-release` builds the production app, verifies its signature and
Gatekeeper acceptance, then creates a DMG with an Applications shortcut and a ZIP
for Electron's updater. It notarizes/staples/verifies the DMG before exposing the
release directory at `platform/desktop/out/release/<version>/`. It also writes
`SHA256SUMS` and Electron's static `RELEASES.json`. The version comes from
`platform/desktop/package.json`; increment it for every release. Release output
is prepared in a temporary directory and never overwrites an existing version.
The same commit adds the release's entry to `src/changelog/changelog.json`,
which the renderer bundles for Settings → Changelog; tests fail when its newest
version differs from the package. Writing rules live in
[its AGENTS.md](../../platform/desktop/src/changelog/AGENTS.md).

`just desktop-publish <version>` verifies the local checksums and uploads to the
`openchart-releases` Cloudflare R2 bucket. Versioned artifacts are cacheable;
the stable `OpenChart.dmg` download and `RELEASES.json` use `no-store`. The manifest
is uploaded last, after the downloads. Authenticate with `wrangler login` first.
The public base URL is `https://downloads.longsurf.ai/openchart/darwin/arm64`.

Production Apple Silicon builds use `update-electron-app` with Electron's native
Squirrel.Mac updater, checking on startup and hourly. Electron validates the
downloaded app's signature. No dialog interrupts the user: main sends the
downloaded release name to open pages and answers pages that load later, and the
sidebar shows a blue download button beside the account. Clicking it enters the
ordinary Quit path, preserving editor cancellation and waiting for backend exit
before `quitAndInstall()`. Without a click, Squirrel installs the download on the
next normal quit. Development packages never check for updates.
App identity remains `ai.longsurf.openchart`; data stays outside the app bundle.

Release acceptance requires installing two successive signed builds and verifying
an actual download/restart update, saved data, real Keychain credentials, and
production login. The mock-Keychain smoke alone does not establish those results.

## Ownership and runtime

Before the backend starts, Desktop's [onboarding content](../../platform/desktop/src/onboarding/content/README.md)
installs a portable SQLite snapshot only when the application database is absent.
Its frozen migration ledger is upgraded by ordinary Database startup. Existing
profiles are never seeded again. The first window opens the bundled Bitcoin
dashboard and receives its ordinary chart preferences before App bootstrap;
subsequent launches retain the normal entry route. No product service knows
about onboarding content, and no live Agent execution is copied or started by the
installer. Enabled alerts use the normal Alert and Trigger services.

```text
Electron main (dist/main/main.js)
  ├─ utilityProcess -> backend (dist/main/backend.js)
  │     createServer(): SQLite, tRPC + SSE + Hose on 127.0.0.1:<port>
  │     parentPort: init {token, credentialKey, home, rendererOrigin}
  │                 -> ready {port} ... notify {title, body} ... shutdown -> exit 0
  ├─ BrowserWindow -> preload (dist/preload/preload.cjs) -> shared App
  │     window.desktop.connection() -> ipc desktop.connection -> {origin, token, profileID, publishableKey}
  │     onUpdateReady / restartToUpdate -> ipc desktop.updateReady / desktop.restartToUpdate
  │     Clerk preload bridge -> native OAuth callback and SDK token storage
  └─ openchart://app protocol handler -> bundled renderer files

renderer -> http://127.0.0.1:<port> (tRPC, SSE) and ws://127.0.0.1:<port>/hose,
            every request carrying the run token
```

Main only hosts: it starts and supervises the backend, opens windows, holds
the credential key, and executes host capabilities the backend requests, such as
showing a system notification. The `parentPort` protocol has four messages:
`init`, `ready`, `notify` and `shutdown`. Main holds no business logic, never
subscribes to the backend, and keeps no second copy of application state. The
backend is the single runtime: one process, one SQLite
database at `<home>/openchart.sqlite3` (`settings.json` and `credential.key`
beside it), one `createServer()` shared by every window. The renderer talks to
the backend directly; main hands it the address and token once per document load.

Startup: main takes the single-instance lock, loads or creates `credential.key`
(32 random bytes stored as safeStorage ciphertext; unavailable encryption or
Linux basic_text fails startup), generates a 32-byte run token, forks the
backend and posts `init`. The backend prepares its home, runs
`createServer()` with that home, encrypted credentials, first-party Access
registration and loopback access guard,
listens on `127.0.0.1:0` and posts `ready`; main registers `desktop.connection`
and creates the window only then. No `ready` within 30 s, or an exit before it,
kills and waits for the child to exit before showing the startup error dialog.
The supervisor returns a process handle immediately; its `ready` promise supplies
the port, while `stop()` also works before readiness. Development builds use the app name
`OpenChart Development`, isolating userData and the Keychain item. Application
home defaults to `~/.openchart` for releases and `~/.openchart-dev` for direct
development-host launches. `--openchart-home=<path>` selects an explicit home;
`just desktop` supplies `.artifacts/dev-profile/home` inside the desktop package,
and smoke supplies a temporary home and separate temporary userData. Electron
userData continues to own browser storage and Clerk sessions. No existing profile
is moved automatically.

Network defaults: before it accepts `init`, `backend-entry.ts` sets two
process-wide defaults, so no module configures connections on its own. Node
tries each address of a host for 250 ms, less than one round trip to distant
hosts such as Binance (about 260 ms), so a new connection could wait through
every address; the backend allows 1 s per address, for `fetch` and `ws` alike.
Node's `fetch` closes an idle connection after 4 s unless the server sends a
Keep-Alive hint, so a request after a short pause reconnected; the backend's
global `undici` Agent keeps idle connections for 30 s. OpenChart, Yahoo and
Binance send no hint and close idle connections after 60, 90 and 170 s; servers
that send a hint keep their own timeout. Node's `fetch` drives that Agent
directly, so the `undici` package stays on the major version bundled in
Electron's Node (7.x).

Desktop's `assets/logo.svg` is the vector master; `assets/icon.svg` composes it
into the macOS icon. The sidebar retains the OpenChart text label. Both package
modes use the checked-in `assets/icon.icns`; see the
[icon export instructions](../../platform/desktop/assets/README.md).

Access: the backend answers only requests whose Host is its bound address,
whose Origin is the renderer origin (`openchart://app`, or the Vite origin in
development), and which carry the token (`Authorization: Bearer` for HTTP and
SSE, `?token=` for the Hose WebSocket). The token lives only in the memory of
main, backend and renderer: never in argv, localStorage, persisted caches,
navigation URLs or logs, and it changes every launch. `desktop.connection`
answers only a window's main frame at the renderer origin. CSP `connect-src`
allows the backend HTTP and WS origins plus the configured Clerk API origin.
Only Clerk's native API requests receive the Electron CORS adaptation.

`desktop.pickDirectory` uses the same main-frame/origin guard and opens a native
dialog attached to the requesting window with only `openDirectory` enabled.
Preload returns one selected path or null on cancellation; the renderer injects
this capability through bootstrap. The shared App owns Workspace registration
through the existing Resource API and navigation after success.

`desktop.openPath` uses the same main-frame/origin guard, parses an absolute
local path, and calls Electron `shell.openPath` to open it with the system's
default application. OS error strings reject the request and reach the App's
shared error notification through `AppHost.openPath`; no shell command is run.

Notifications: the backend posts `notify {title, body}` whenever a server
service uses the [Notification capability](alert-trigger.md#notification); it
may precede `ready`. Main parses every backend message for the child's lifetime
and, where Electron supports notifications, shows one; clicking it restores,
shows and focuses the open window. An invalid message fails a pending startup
and is only logged afterwards.

`desktop.enableNotifications` uses the same main-frame/origin guard and shows a
fixed confirming notification through the same path. Electron offers no
permission request, so this first notification is what lets macOS ask the
user; the answer stays with the system and is not reported back. Onboarding
calls it through `AppHost.enableNotifications`.

Quit: open editors first resolve their `beforeunload` decision; canceling keeps
the backend available for saving. Once windows accept closing, `will-quit`
posts `shutdown`; the backend runs `server.shutdown()` and
exits 0. Main kills it after 5 s but treats only the exit event as confirmation,
then quits. A Quit during startup posts shutdown immediately and uses the same
5 s deadline. Repeated Quit requests share that shutdown and cannot bypass it.
An unexpected backend exit shows a Relaunch/Quit dialog; committed data is
already in SQLite. Closing the last window follows the platform default.

The stable application origin supports browser history. The asset handler
serves bundled files and falls back to index.html for HTML navigation or
extensionless HEAD document probes; missing assets and API requests remain
failures. Renderer sandboxing and context isolation are enabled; Node
integration is disabled. Pages may write to the clipboard; every other
permission, including device access, is denied, as are new windows. External
HTTP(S) links open in the system browser. Release builds ignore the
development URL; only the build-time development flag permits Vite.

Workspace previews use local Blob URLs for images and PDF reads. CSP permits
these image/fetch URLs and bundled PDFium WebAssembly compilation; Monaco
workers and PDFium assets ship locally with the renderer.

macOS uses `hiddenInset` with native window buttons. Desktop's `renderer.css`
marks the existing sidebar and page headers as draggable, keeps their controls
clickable, and reserves button space when the sidebar is expanded or collapsed.
These styles apply only to the Mac desktop renderer.

## Bundles

`tooling.ts` produces `dist/main/main.js` (host), `dist/main/backend.js` (a Vite
SSR build of `backend-entry.ts` for Node 24 with every dependency bundled except
`electron`, `ws`, `@anthropic-ai/claude-agent-sdk`, `typescript` and Node builtins; the
server's `agent/**/*.txt` prompt files are emitted beside it),
`dist/preload/preload.cjs` (CommonJS, as sandboxed preloads require) and
`dist/renderer/`. `node:sqlite` is a builtin, so nothing native is rebuilt.
All three commands copy the `ws`, `@anthropic-ai/claude-agent-sdk` and `typescript` packages
into `dist/node_modules` during runtime assembly, so `desktop-build` also produces
a self-contained runtime. Tea uses the shipped TypeScript transpiler in-process,
so compilation needs no native executable or ASAR unpacking rule.
Tea's compiler-shipped sources live in `dist/tea-lib`, beside the backend's parent directory.
Tea's package build generates its reference. Desktop stages Markdown and library
sources from the same installed Tea package as its compiler, together with
OpenChart's binding guide from `docs/agent/tea.md`. Tea documentation changes require
rebuilding and reinstalling that package. Packaging copies the guides to
`Contents/Resources/docs/tea/` and `Contents/Resources/docs/openchart/tea.md`,
with a readable copy of the standard-library `.tea` sources in `docs/tea-lib/`,
outside ASAR, where native Agent file readers can open them. Main passes the
actual `process.resourcesPath/docs` through the host protocol to the Agent
profile prompt, so relocation preserves the link. Tea owns its language docs
and generated reference; OpenChart owns distribution and integration guidance.
The bundled logo Dataset's metadata and images are copied into `dist/main/assets`;
the backend reads them relative to its own module, including after relocation
and inside ASAR. Images never enter the renderer's JavaScript bundle.
`just desktop-tea-smoke` relocates the built runtime and compiles Tea through its HTTP API.
Development and release hand this same layout to the
same Electron Packager configuration with ASAR enabled, keeping source and
environment files outside the bundle. Development launches the packaged
executable with the stable `platform/desktop` source directory as cwd, so rebuilding
the bundle cannot leave native providers in a deleted working directory.
App identity, output location, development
profile, Clerk configuration and the renderer's Vite URL distinguish development;
backend entrypoints and dependency resolution stay shared.

The backend bundles the workflow authoring API and uses its own TypeScript
compiler to load workspace files. It installs no packages or configuration into
user workspaces; no separate authoring artifact or ASAR unpacking is required.
See [workflow authoring](workflow.md#workspace-authoring).

Desktop's Vite plugin substitutes the native renderer entry before HTML
processing; a build assertion rejects inclusion of the browser-only entry or
mock APIs. App Vite/Tailwind configuration owns renderer compilation.

## Storage foundation

Settings file ownership is in `server/config`: the backend reads, watches and
atomically updates `<home>/settings.json`. The desktop host supplies the
profile directory; there is no separate KeyValueStore. The connection includes
a stable `profileID: 'desktop'` for the renderer's startup theme hint. Electron
userData already isolates browser storage across profiles, while the backend port
and access token change each launch. See [configuration](configuration.md).

`src/credentials.ts` exports `loadCredentialKey(file)`: main's safeStorage-
protected 32-byte key, written atomically (sibling temp file, mode 0600, rename)
and handed to the backend for `jweEncryption`. It rejects unavailable encryption
and Linux basic_text and never falls back to plaintext. Credentials do not
belong in ordinary KV.

All safeStorage operations use asynchronous APIs so OS permission dialogs do not
block main-process events. If decryption reports `shouldReEncrypt`, the same
32-byte credential key is encrypted again and its file is replaced atomically.
Failed encryption or replacement preserves the old file.

## Verification

`just check` covers desktop types, lint, asset boundaries, backend supervision
(fake utility process), main-process Quit ordering, protocol parsing and the
credential key file. Run the
package readiness smoke test with its executable path:

```sh
just desktop-smoke '/absolute/path/OpenChart.app/Contents/MacOS/OpenChart'
# A complete development package uses the same checks, with its expected identity:
just desktop-smoke '/absolute/path/OpenChart Development.app/Contents/MacOS/OpenChart Development' development
```

The smoke test copies the complete application to an OS temporary directory
outside the checkout, clears Node resolution overrides, and verifies it runs from
`app.asar`. This prevents missing dependencies from being supplied by repository
ancestors. It uses temporary user data and checks model discovery, authenticated
SSE readiness and Hose protocol replies, direct chat entry, settings and theme
persistence, New Chat drafts and first-send Session creation, reload, restart with the persisted
chat listed, renderer isolation, and asset boundaries. Normal Quit must observe
backend exit within 5 s and leave no backend process. No account sign-in or
per-user Clerk configuration is required; the executable uses its bundled public
key. Artifacts are saved under
`platform/desktop/.artifacts`.

The smoke defaults to `--use-mock-keychain` on macOS. Add `production system`
after a signed executable path to exercise real Keychain encryption across
restart with an isolated application profile. Unit tests cover key reload and
decryption failure; deleting a real OS Keychain entry remains a manual check.

The Settings smoke also opens a second renderer, checks file-driven Config
updates across windows, and configures an isolated OpenAI-compatible HTTP fixture
through the UI. It verifies an Agent reply, selecting
a `.workflow.ts` file with `@`, executing a model-issued workflow tool call with
a real child Session without adding workspace support files, and credential persistence across
restart, without placing the API key in settings.json. Native providers are
disabled in this deterministic scenario; live native-account acceptance is a separate release check.
