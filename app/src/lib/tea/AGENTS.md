# Tea client

- `createTeaClient` shares AppTransport's tRPC/Hose. Common codecs preserve
  Arrow schemas, nesting, null and NaN. No Effect runtime or server imports.
- Observe is cold: subscribers own channels, cancellation and snapshot order.
  Consumers own presentation and retention; no replay or restart.
- `dispose({id})` releases one script. `close()` drains compiles and disposes
  owned IDs. Never abort admitted compiles and lose IDs. Failed releases retain
  ownership; another close retries. Cleanup never uses aborted signals.
- Connection composition supplies `TeaClientContext`, awaits close before
  disconnecting; only `hooks/use-tea.ts` borrows it.
- App-written configs stay JSON (`AlertConfig`, `encodedBarsInputs`); `write*`
  prints canonical text. Only explicit overrides persist; `teaParameters`
  fills defaults.
- `useTea` compiles per content (paths reread per mount), replaces whole rows
  and disposes late results. Config JSON identifies execution. Window/warmup
  changes retain data until snapshot or on failure; other changes clear it.
- `useTeaGroup` scopes sharing to one mount: canonical snapshots compile once;
  effective configs/windows share runs, independent of consumer IDs/outputs.
  Four startup slots release at first snapshot. Retain only the latest whole
  row; errors clear values. Last-consumer cleanup releases late results too.
  Its observable publishes ticks without rerendering the binding owner.
  The client alone validates snapshot ordering. Test real HTTP/Hose transport.
