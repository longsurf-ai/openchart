# alert

Owns Alertable observation and editing. See
[alert-trigger contract](../../docs/architecture/alert-trigger.md).

- `tea-alerts.ts` owns compilation, nominal decoding, live updates and disposal.
  Market identity comes from a node's Bars inputs; payload `input: string[]`
  names a request's; scripts with requests never inherit root aliases.
- `alert.ts` runs one FiberMap fiber per enabled rule; disposal precedes
  replacement. Each reports Monitoring `alert/<ruleId>`: every evaluation, even
  `[]`, is healthy; failures report failed and retry with capped backoff.
- `drawing-alerts.ts` lowers Drawing anchors to `geometry` Tea with confirmed
  Crossing/Touch; Touch is a one-slot low–high rectangle, never viewport
  pixels. Over 1,000 anchors fail authoring. Drawing edits restart rules,
  deletion disables them, hidden drawings observe. Never copy geometry into
  Rules or rearm Once on edits.
- An `indicatorId` config runs that Indicator as `nodes.indicator` on its
  cell market (`indicator.<output>`); TeaAlerts gets only `ruleRequest`'s
  NodeConfig and `nodes`. Edits or market moves restart; loss disables.
- Only updates fire; never replay snapshots, throttle or dedupe.
  `recordAlertFire` rechecks revisions and retires Once atomically before the
  id-only `alert.fired`.
- `starters.ts` and `conditions.ts` own exact source projections, parameter
  validation and warmup; saved source stays authoritative; custom code is
  never partially converted.
- Resource schemas and `save` live in `resources/`. Tea requests are static.
