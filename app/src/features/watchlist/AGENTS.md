# watchlist

Owns Watchlist browsing, sections, quote columns and Formula columns.

- Card chrome owns drag and close. `header.tsx` owns switching, naming, adding,
  and the flat column menu. `widget.tsx` owns selection, writes and dialogs.
  App composition injects symbol/code pickers and Workspace navigation.
- New watchlists copy complete columns with fresh IDs. Hiding preserves
  configuration; removal deletes only the column, never its code.
  Failed writes retain drafts. Open code preserves Formula drafts;
  Reload explicitly replaces snapshots.
- `utils/tree.ts` maps entities to tree nodes and JSON Patch. Edits use the last
  saved revision; a drop is one `move` resolved after removal. Formula settings
  submit their edited revision.
- Headless Tree owns expansion, keyboard, drops, and drag lines. Unnamed sections
  stay open and indent nothing. Row clicks and Enter raise ViewChart.
- Quotes use two latest daily bars; `sparkline.tsx` draws session days with a
  shared crosshair. Feed receives only `{provider, listing}`.
  Formula execution includes collapsed/offscreen rows. Results stay outside
  Resources; sorting samples at 250 ms with missing values last.
- Selection, collapse and stable-column-ID sorting are placement-local.
  Version 1 metric sorts resolve after the selected list loads.
