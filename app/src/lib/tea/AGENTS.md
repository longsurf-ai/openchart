# Tea client

- `createTeaClient` shares AppTransport's tRPC and Hose clients. Common codecs
  own wire shapes and keep Arrow metadata, nesting, null and NaN. The client
  decodes `CompileResponse` and messages, and encodes observe requests, whose
  Arrow schemas don't survive JSON. No Effect runtime or server imports.
- Observe is cold: each subscriber owns a channel, with enforced cancellation
  and snapshot ordering. Consumers own presentation, viewport and retention; no
  replay or restart.
- `dispose({id})` releases one script. Async `close()` stops admission, drains
  compiles and disposes every owned ID; never abort an admitted compile and
  lose its ID. Failed releases keep ownership and close rejects; another close
  retries. Cleanup never uses the aborted signal.
- Connection composition owns one client, supplies `TeaClientContext` and
  awaits close before disconnecting; only `hooks/use-tea.ts` borrows it.
- App-written configs stay JSON (`AlertConfig`, `encodedBarsInputs`); `write*`
  print canonical text, so equal configs compare equal.
- `hooks/use-tea.ts` compiles once per content (paths re-read per mount),
  observes separately, replaces whole rows and disposes late results. Only
  explicit overrides persist; `teaParameters` fills defaults. The config's JSON
  is its execution identity: window-only refreshes, `warmupBars` included,
  keep data until a snapshot or on failure; other changes clear it. Test real
  HTTP/Hose transport.
