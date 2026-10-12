# watchlist

Owns independent watchlists. Widgets select them in local view state;
Dashboards never own that selection.

- schema.ts owns watchlist/watchlist_section/watchlist_item. Sections and items
  share the root's revision and cascade with it. Sections use
  `parent_section_id`; positions are per sibling list.
- column.ts owns inline JSON columns: stable IDs, optional titles, shared
  visibility (legacy defaults true), built-ins and Formula snapshots/settings.
  Hide retains configuration; remove deletes it. Results are never persisted.
- Formula transitions compile outside the write transaction, validate output
  and overrides, then recheck revision before saving. Configure uses saved
  code; Reload captures source/import edits. Generic patches validate structure
  without compiling. Temporary compiled nodes are released.
- Recursive sections use `Schema.suspend` and `type` aliases. Keep decoding
  defaults out of recursion so Agent JSON Schema export works.
- Invariants require unique column/section/item IDs, one listing across the
  tree, and one column per built-in metric, including hidden columns. Formula
  columns may repeat.
- Store assembles depth-first, replaces the tree on save, and rereads writes.
  Moving a row or subtree uses one RFC 6902 `move`.
- Widths, sorting, collapse, density, and decimals are widget view state.
