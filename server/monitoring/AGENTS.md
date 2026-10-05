# monitoring

Owns user-facing current health. See
[alert-trigger contract](../../docs/architecture/alert-trigger.md#monitoring).

- Owners report what they know through `Monitoring.check(label)`; it reads the
  `Reporter` Reference, so callers gain no service requirement and unbound work
  (charts) reports nowhere. Composition binds a Status key with `reporter`.
- A Status is a flat group of Checks; its health is the worst check. Checks
  never nest and a Status reports nothing itself.
- Green must be re-earned: checks start `unknown`, `validFor` reports lapse to
  `unknown`, and closing a check's Scope removes it and ignores late reports.
- In memory only; restarts re-earn every status. No metrics store: Effect
  Metrics stay for counts/timings once an exporter reads them.
- A Status's interruption survives checks handing over and recoveries under 60 s
  (`interruptionHold`); `since` is its start. Reading records that progress.
- `background.ts` publishes `monitoring.changed` when a state or reason changes and
  notifies once when an interruption reaches 60 s while failed/unknown (degraded
  stays in-app), plus recovery after the hold. Notification stays
  best-effort; the app status is authoritative. Monitoring never drives execution
  or retries; owners do.
