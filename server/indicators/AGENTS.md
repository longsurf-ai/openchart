# Indicators

Owns bundled starter files and their browse/install API, not execution.
Built-in originals are read-only in the application and follow the bundle:
startup makes every catalog original in the default Workspace match its bundled
text, restoring missing files and rewriting outdated or externally changed ones.
No installation ledger is needed.

The catalog owns original paths. Workspace rejects writing, deleting or renaming those
paths in the default Workspace; copies and other workspaces remain ordinary files.
Chart mounting never installs files. TeaService owns compilation and execution.
Chart built-ins (`chartBuiltins`), such as the range volume profile, are
originals the chart runs itself: installed and protected the same way, never
listed for browsing.

The catalog contains discovery metadata only: semantic goals, authored recreation
prompts and reading guides for every original. Prompts describe actual bundled
behavior, not historical generation provenance. Never duplicate executable input
metadata here. Each file owns its `indicator()` header, defaults and outputs;
plot values and the compiled output schema own rendering. Keep templates self-contained.
