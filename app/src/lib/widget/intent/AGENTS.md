# Intent

Routes typed requests between widgets that never import each other, after
FDC3 intents. A source says what the user wants; a resolver picks one answering
placement; the handler decides how. See
[widget architecture](../../../../../docs/architecture/widget-architecture.md).

- `intents.ts` declares every intent once: FDC3-style name, payload, delivery.
  Payloads are plain data the handler can act on; never Resources or handles.
- `intent.ts` is React-free. The router keeps registrations, activation order
  and one delivery lane per handler; it stores no context and never broadcasts.
  `mostRecentlyActive` excludes the requester, then prefers recent work.
  `latest` delivery keeps one waiting request; `each` keeps all, in order.
- `raise` never rejects. Handlers report their own failures; outcomes only let
  awaiting callers keep state. Unavailable intents are a normal outcome.
- `WidgetIntentProvider` scopes one router to its owner; DashboardPage mounts it per
  Dashboard and WidgetHost activates placements. Hooks live in
  `hooks/use-intent.ts`; handlers register only inside a placement.
- Resources stay the source of truth: handlers write through their owner's
  Query mutations, never a second copy of the selection.
