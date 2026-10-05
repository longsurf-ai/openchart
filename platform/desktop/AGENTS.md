# Desktop

Owns Electron startup, backend, storage, packaging, updates and the
[changelog](src/changelog/AGENTS.md). See [architecture](../../docs/architecture/desktop.md).

- Main owns windows, credentials, run token and host capabilities
  (notifications), no business logic; backend-entry sets network defaults,
  then starts server.
  Preload exposes connection, folder picker, updates and Clerk's bridge.
- Parse all four host-protocol messages. Secrets stay in messages, never argv/URLs/logs.
  Readiness expires after 30 seconds. Quit/repeated Quit await backend cleanup
  and exit. Pre-ready failures log/exit in development; release dialogs await ready.
- Credentials use async safeStorage; reject unavailable/basic_text encryption
  and plaintext fallback. Re-encryption preserves the key.
- Open windows after backend readiness. IPC accepts only the renderer's main
  frame. Preserve sandboxing, context isolation, disabled Node integration,
  denied device permissions/new windows, navigation restrictions and CSP.
- Config owns settings; Home owns paths. Assets stay inside bundles; missing
  files/APIs never become HTML. Only development accepts loopback URLs.
- Development/release share ASAR layout and packaged dependencies. Tea
  transpiles in-process. Dev profile persists; dev/smoke use mock Keychain.
  Smoke relocates packages.
- Releases require bundled `pk_live_`; Clerk owns sessions; Auth owns account RPC.
  Only development builds honor `--openchart-test-account` (Clerk test mode).
- Production uses Longsurf Developer ID and `openchart-notary`; development is
  ad-hoc. Verify downloads before publishing R2 metadata last. Sidebar
  update restart honors editor cancellation and backend exit. Development never
  auto-updates.
