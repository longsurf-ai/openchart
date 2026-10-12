# custom-widget

Owns saved custom widget code: one checked `.widget.tsx` snapshot per kind.

- Every field is server-managed. `save` reads and checks the Workspace file
  outside the transaction, then inserts or revises the widget its declared
  `kind` names. The saving file updates freely; another file is
  refused until that widget is deleted. Unchanged snapshots write nothing. Intrinsic
  create is refused; delete stays available.
- `kind` is unique in SQLite and matches the compiler's rule. `source` only
  records where the snapshot came from; there is no FK to the file.
- `compiled` is a query that transpiles the stored snapshot per read; compiled
  code is never stored.
- Dashboards place widgets as `custom:<kind>`; placements carry no reference.
