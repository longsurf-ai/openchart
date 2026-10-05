# macros

Owns cross-Resource operations outside individual Resource directories.

## Invariants

- A macro is an ordinary Transition with resolve/apply phases. The caller runs
  it once through Transactor; apply uses the supplied transaction and never
  opens another one. There is no separate macro runner or registry.
- Both reads and writes compose intrinsic or custom Resource transitions through
  the Resource entry points. Macros contain no SQL and never access stores or
  table schemas. OpenChart ESLint rejects those imports and direct `.store` access.
- Simple reads use ordinary Resource lists and filter in the caller. Do not add
  a macro solely to optimize a local-app lookup.
- Backend query transitions return decoded domain entities. SQL and row mapping
  stay in the respective Resource stores; macros never decode stored rows.
- `follow-indicator.ts` reads what a following rule follows now;
  `ruleRequest` turns any stored rule config into a NodeConfig plus `nodes`
  for Rule save and the Alert runner.
- `createChartWidget` owns the default Binance BTCUSDT daily starter and saves
  existing placement geometry plus the new Chart placement in one transaction.
  `createDashboardWithChart` composes it with Dashboard create without Feed access.
  Ordinary Dashboard create remains empty.
