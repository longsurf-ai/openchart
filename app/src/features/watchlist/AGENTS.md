# watchlist

Owns Watchlist browsing, sections, and metric columns.

- Card chrome owns drag and close. `header.tsx` owns switching, naming, adding,
  and columns. `widget.tsx` owns placement-local selection, the shared save
  mutation, picker, and dialogs. App composition injects SymbolPicker.
- Deletion selects another list or leaves creation available. New lists
  copy current columns, else a price/change/change% starter.
  `watchlist-menu.tsx` scrolls React Query cursor pages; only confirmed missing
  details invalidate selection. Deletions require confirmation; failed writes
  keep dialogs and drafts.
- `utils/tree.ts` alone maps the nested entity to tree nodes.
  Every edit is JSON Patch built from the last saved revision; a drop
  is one RFC 6902 `move` whose path is computed after removal.
- Headless Tree owns expansion, keyboard, drops, and drag lines. Unnamed sections
  stay open, indent nothing, and anchor drag lines. Row clicks and Enter raise
  ViewChart.
- Quotes come from each row's two latest daily bars; `sparkline.tsx` draws
  session days with a shared crosshair. Send Feed only `{provider, listing}`.
  A session-local RxJS subject feeds cells and samples sorting at 250 ms. Rows
  release quotes on unmount; failures offer Retry.
- Selection, collapse and sort are placement-local. Sorting orders rows within
  sections; sorted rows drop only onto sections.
