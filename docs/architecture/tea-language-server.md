# Tea language server

Tea owns parsing, checking, diagnostics, and language queries in the public
`vendor/tea` submodule. OpenChart connects its workspace editor to that language
server; it does not add a second language implementation.

`server/tea/lsp.ts` embeds `startLanguageServer` from `tea/lsp` in an independent
duplex Hose channel. `JsonRpcTransport` carries protocol messages between the
editor and the in-process server. The channel owns the connection lifetime;
LSP exit closes that channel without exiting the application host.

Tea reports the files a session depends on. Workspace observes those files and
invalidates the session when they change. Ending the channel aborts observation
and disposes the protocol connection and transport.

The shared code-editor component owns editor presentation. Its caller owns
the workspace identity, file persistence, and language session. Read-only source
viewers do not create workspace identities or start language sessions.

Language-server analysis is separate from execution. Compilation, bindings,
finite runs, and live observations belong to the [Tea service](tea.md).
Workspace owns access to application files; Tea's loader owns import semantics.

The transport is covered by `server/tea/lsp.test.ts`; Tea's independent tests
cover the language behavior. Run the application checks with `just check` and
Tea's tests with `just tea-test`.
