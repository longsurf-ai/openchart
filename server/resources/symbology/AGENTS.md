# Symbology Resource

- One saved listing per `(provider, listing.id)` when a native ID exists; otherwise `(provider, symbol, venue)`. Distinct native IDs may share a symbol and venue. No instrument or cross-provider identity merge.
- `readOnly` hides public CRUD. Only search/count reads are registered custom transitions. Backend upsert/replacement exports never enter the public router.
- Search observations only upsert. Complete index snapshots replace exactly their provider/filter scope in one transaction; failures preserve the prior catalog.
- Unchanged listings retain ID/revision. Counts derive from rows; jobs belong to Feed and are not persisted here.
- Stores own SQL; Feed uses transitions through `resource.ts`. SQLite generates native identity from Listing JSON.
