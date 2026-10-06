# drawing

Owns completed drawing geometry, style and visibility as independent Resources.

- Dashboard deletion cascades drawings; removing a chart or switching a listing
  does not. Provider plus Listing supplies identity, never a fabricated numeric ID.
- Chart coordinates accept only Unix epoch seconds; legacy representations are
  converted once by a forward database migration, never during reads or rendering.
- Core's `Drawing.SavedItem` is the shared Effect schema for completed geometry.
  Consume it directly; never rebuild it from JSON Schema or duplicate constraints.
- `data.id` is the client-minted gesture identity; the Resource envelope owns the
  server ID and revision. Drafts, selection, hover and caches remain in the renderer.
- SQLite enforces unique `data.id` within dashboard/provider/listing identity
  (native ID, otherwise symbol and venue); listing metadata and JSON key order do not distinguish
  drawings. Store translates this index's conflict to `/data/id` diagnostics.
  Conflicting historical rows fail migration atomically; never silently discard
  drawings or rewrite their identities.
- List by dashboard/provider with bounded SQL windows. Resource transitions own
  revision checks and decoding; the database owns committed change events.
- Append forward migrations. Tests use memory or temporary databases.
