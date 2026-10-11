# watchlist

Owns Watchlist browsing, sections, and metric columns.

- Card chrome owns drag and close. `header.tsx` owns switching, naming, adding,
  and columns. `widget.tsx` owns placement-local selection, the shared save
  mutation, picker, and dialogs. App composition injects SymbolPicker.
- Deletion selects another list or leaves creation available. New
  watchlists copy current columns, or use the price/change/change% starter.
  `watchlist-menu.tsx` scrolls React Query cursor pages; only confirmed missing
  details invalidate selection. Deleting lists or sections requires confirmation;
  failed writes keep dialogs and drafts.
- `utils/tree.ts` is the only mapping between the nested entity and tree
  nodes. Every edit is JSON Patch built from the last saved revision; a drop
  is one RFC 6902 `move` whose path is computed after removal.
- Headless Tree owns expansion, keyboard, drops, and drag lines. Unnamed sections
  stay open and indent nothing; their DOM anchors position drag lines.
- Quotes come from each row's two latest daily bars through Feed. Send Feed
  only `{provider, listing}`. A session-local RxJS subject feeds cells and samples
  sorting at 250 ms. Rows release quotes on unmount; failures offer Retry.
- Selection, collapsed sections and sort are placement-local. Sorting orders
  rows within each section; sorted rows drop only onto a section.
