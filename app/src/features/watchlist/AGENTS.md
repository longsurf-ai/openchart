# watchlist

Owns Watchlist browsing, sections, quotes, Formula and research columns.

- Card chrome owns drag/close; `header.tsx` owns switching, naming, adding and
  column menus; `widget.tsx` owns selection, writes and dialogs. App composition
  injects symbol/code pickers and Workspace navigation.
- New watchlists copy complete columns with fresh IDs. Hiding preserves configuration;
  removal deletes only the column. Failed writes retain drafts. Open code preserves
  Formula drafts; Reload replaces snapshots.
- `utils/tree.ts` owns tree nodes and JSON Patch. Edits use saved revisions; drops
  use one move resolved after removal. Formula settings submit their edited revision.
- Headless Tree owns expansion, keyboard, drops and drag lines. Unnamed sections
  stay open without indentation. Row clicks/Enter raise ViewChart.
- Quotes use two latest daily bars; sparklines share session days/crosshair. Feed
  receives `{provider, listing}`. Formula execution includes offscreen rows.
- Results stay outside Resources; sorting samples every 250 ms, missing values last.
  Research projects bound Sessions/workflow spans; only mounted cells sort.
- Selection, collapse and column-ID sorting are placement-local. Version 1 metric
  sorts resolve after loading.
- Explicit replacement preserves row IDs/sections. Retired quotes offer replacement.
- Research displays/sorts only for matching captured market provenance. Unknown or
  mismatched research retains transcript access and refresh, never relabelled answers.
