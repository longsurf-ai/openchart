# Tea service

`tea.ts` owns compiled scripts and observations. Workspace resolves directory IDs; Feed owns sessions; Tea owns language semantics.

- One bound Module, Definition, declaration and Scope per ID survives source
  edits; dispose closes admission, then stops runs. Snapshots never read user
  files; `includeSources` returns compiled texts.
- Admission checks the root and every `nodes` ID; only the root's Scope parents
  the run and its nodes; failed finer bars rebuild once on the request's.
- Files own their checks ([architecture](../../docs/architecture/tea.md)):
  - `source.ts`: one series, the only Feed reader: empty at build, filled at
    run; ordering and finality once.
  - `wiring.ts`: map coverage of the bound level; projections.
  - `bind.ts`: binds and wires top down; starts the Node before any push.
  - `node-graph.ts`: connection checks; one Source per series, on
    `runResolution` bars for auto scripts; `validate` stops here.
  - `run.ts`: hidden `warmupBars`; history pushed in slices; children open at
    the earliest top-level start, push first; no live Samples; finite inputs
    end together; sets `live` and `newest`.
- Build errors (`invalid_request`) name `nodes.<key>`/`.requests.<name>` and
  the input, or a derived child's variable.
- `lsp.ts` adapts Hose to `tea/lsp` without execution; disposal releases it;
  LSP exit never ends the host.
