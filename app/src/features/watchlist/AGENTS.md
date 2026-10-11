# watchlist

Owns the Watchlist browser, its section tree, and shared metric columns.

- Card chrome owns drag and close. `header.tsx` owns switching,
  naming, adding, and columns inside the content. `widget.tsx` selects from the
  placement-local persisted view store; Dashboard stores no Watchlist selection;
  its Provider owns the picker and dialogs. App composition supplies the
  chart's SymbolPicker through `WatchlistSymbolPicker`.
- Deletion selects another list or leaves creation available. New
  watchlists copy current columns, or use the price/change/change% starter.
  `watchlist-menu.tsx` scrolls React Query cursor pages; missing details, never
  absence from a loaded page, invalidate selection.
- `utils/tree.ts` is the only mapping between the nested entity and tree
  nodes. Every edit is JSON Patch built from the last saved revision; a drop
  is one RFC 6902 `move` whose path is computed after removal.
- Headless Tree owns expansion, keyboard, and drag-and-drop. Rows render only
  for named sections; unnamed sections stay open and indent nothing.
- Quotes come from each row's two latest daily bars through Feed. Send Feed
  only `{provider, listing}`; Feed rejects extra fields such as row ids.
- Selection, collapsed sections and sort are placement-scoped view state. Sorting orders
  rows within each section; sorted rows drop only onto a section.
