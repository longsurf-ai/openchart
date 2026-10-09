# watchlist

Owns independent watchlists: ordered metric columns and a recursive tree of
sections holding provider-scoped listings. Dashboards reference a watchlist
through `widgets[].resourceId` and never own it.

- schema.ts owns watchlist/watchlist_section/watchlist_item. Only the root has
  an envelope; sections and items share its revision and cascade with it.
  Sections link through `parent_section_id`; positions are per sibling list.
- column.ts owns the column and metric contract; columns stay inline JSON.
- The entity nests `sections[].sections[]` to any depth through
  `Schema.suspend`. Keep codecs such as decoding defaults out of the recursion;
  Agent JSON Schema export cannot document them. Recursive types are `type`
  aliases so they remain JSON objects.
- Invariants walk the tree with scoped `at` contexts: ids are unique per
  watchlist, each listing appears once across all sections, and each metric
  appears once among columns.
- Store maps rows to the tree depth-first, replaces the tree on save, and
  re-reads what it wrote. Moving a row or subtree is one RFC 6902 `move`.
- Market values come from Feed; widths, sort, collapse, density, and decimals
  are frontend view state.
