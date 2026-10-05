# App connection

- `use-backend-connection.ts` owns shared transport, Tea client, readiness, and
  Resource/Config/Workspace observers. Agent clients and observation belong to `lib/agent/use-agent.ts`.
- Mount once from Layout so child-route navigation preserves the connection.
  Manual reconnect replaces transport; Layout keys consumers by `attempt`.
- Layout injects the stable Tea client through Context. Route/indicator removal
  never closes it. Reconnect hides retired services before supplying the new scope.
- Cleanup releases app subscriptions and cached Config, awaits Tea close (including
  late compilation IDs), then disconnects that scope's HoseClient. Shutdown failures
  produce a notification. Features release their own nodes/subscriptions; unrelated
  durable backend executions keep their independent lifetimes.
- This is app composition: keep it outside shared `lib/` and `hooks/`.
  Theme, notices, and navigation remain in Layout.
