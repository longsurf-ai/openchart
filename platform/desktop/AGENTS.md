# Desktop

Owns Electron startup, backend, storage, packaging, updates and the
[changelog](src/changelog/AGENTS.md). See [architecture](../../docs/architecture/desktop.md).

- Main owns windows, credentials, run token and host capabilities, not business
  logic. Backend-entry sets network defaults before starting server.
- Parse all host-protocol messages. Secrets stay in messages, never argv/URLs/logs.
  Readiness expires after 30 seconds. Quit awaits backend cleanup.
- Credentials use async safeStorage; reject unavailable/basic_text encryption
  and plaintext fallback. Re-encryption preserves the key.
- Open windows after backend readiness. IPC accepts only the renderer's main
  frame. Preserve sandboxing, context isolation, disabled Node integration,
  denied device permissions/new windows, navigation restrictions and CSP.
- Config owns settings; Home owns paths. Assets stay inside bundles; missing
  files/APIs never become HTML. Only development accepts loopback URLs.
- Development/release share runtime assembly. Smoke relocates packages.
  Windows alone stages/unpacks node-pty; Mac staging remains architecture-neutral.
- Production bundles `pk_live_`; Clerk owns sessions. Only development honors
  `--openchart-test-account`. Development/unsigned builds never auto-update.
- Targets owns platform routing. Mac releases use Longsurf Developer ID and
  `openchart-notary`; Windows signing is explicit. Unsigned installers are test-only.
- Handle Squirrel lifecycle before normal startup. Update restart preserves editor
  cancellation and backend cleanup. Verify downloads before publishing feeds last.
