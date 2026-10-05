# Tea service

The Tea service runs Tea scripts over market data for charts, alerts and the
Agent. [`tea.ts`](tea.ts) is its entry point: `compile` keeps a script by id,
`observe` runs it over a time window, `validate` checks a config without loading
data, and `dispose` releases a script and stops its runs.

Running a script takes four steps:

1. **Compile** ([`tea.ts`](tea.ts)): the source becomes a Module, the script's
   runnable form, compiled once and reused by every run.
2. **Prepare the Sources** ([`node-graph.ts`](node-graph.ts),
   [`source.ts`](source.ts)): one empty stream per market series, shared by
   every script that reads it. The scripts are ordered so that one another
   script reads comes first. A script whose header says
   `indicator(..., timeframe = "auto")` reads finer bars of the same listing
   than the chart's, and so does every script that reads the same bars.
3. **Bind and wire** ([`bind.ts`](bind.ts), [`wiring.ts`](wiring.ts)): binding
   fills in a script's parameters and market facts, which decide the columns it
   reads; wiring connects each column to a stream. A `request.security` child is
   bound the same way, over Sources of its own. The script's Tea Node then
   starts, still without data, so mistakes surface early.
4. **Start the run** ([`run.ts`](run.ts)): fetch each Source's rows (from Feed,
   or a request's samples), push them in, return a snapshot, then stream live
   updates. When Feed can't serve the finer bars, the run starts once more on
   the chart's.

`validate` stops after step 3.
