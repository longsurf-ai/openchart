# bus

Owns the backend-only, process-local event channel between server services. See
[alert-trigger contract](../../docs/architecture/alert-trigger.md).

- One pub/sub implementation, two isolated instances: `bus.ts` builds its
  Service from `Events.make`. Fix delivery behavior in [events](../events/AGENTS.md),
  never fork it here.
- Never reachable from a client transport. No router, SSE, tRPC, or Hose
  adapter; never bridge Bus and Events in either direction.
- Messages carry ids only. Consumers re-read the Resource for full data.
- Live-only: no history, replay, or durable queue. A crash between commit and
  dispatch, or a subscriber overflow, loses that action (best-effort).
- Persist, then publish, is the publisher's duty; Bus owns no transaction logic.
- Event definitions stay with their publisher, never here.
- Overflow fails the subscriber explicitly; subscribers decide how to resubscribe.
