# Calendar provider

Expands local calendar tables into openchart.market.calendar day rows.

- schema.ts owns hosted-compatible table declarations; data.ts validates Drizzle
  reads and, as `CalendarRows`, Cloud's JSON rows with the same integrity checks.
  Existing files may lack constraints, so corrupt rows fail explicitly.
- Sessions use market `AtomicSessionType`; overnight rules pass through.
- Composition owns a read-only connection. Construction reads one consistent
  transaction and retains rows only; never open/migrate/write/close that database.
  Rebuild to load changes; callers may close after construction.
- Monday is weekday 0. Cross-midnight sessions retain their start date; do not
  invent an end-date trading convention.
- Child calendars override weekday/session rules and dated exceptions. Missing
  parents, cycles, invalid zones/times, and overlapping sessions fail. Reject
  unsupported rule/override types instead of inventing semantics.
- Availability derives from rules/exceptions, never Provider configuration or
  inferred date bounds. Require time.from plus time.to or count for finite,
  ascending results; holiday extrema and current time imply no coverage limits.
- Closed dates are rows with empty sessions. Count caps matched rows; fewer
  results mean the requested finite range is exhausted.
- Temporal owns arithmetic/timezone conversion. Ambiguous or nonexistent session
  clock times fail rather than shifting silently.
