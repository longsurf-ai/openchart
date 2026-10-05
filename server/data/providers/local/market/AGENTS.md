# Local market datasets

Local market Dataset declarations and calendar implementation.

## Invariants

- `index.ts` exports the local `calendar` declaration. Cloud bars belong to
  `data/providers/openchart/datasets/definitions`, alongside their Provider implementation.
- Calendar keys identify calendars, not listings. Symbology owns their mapping.
- Every returned calendar date has a row, including closed dates with no sessions.
- Session windows are half-open Unix-millisecond intervals, ordered and non-overlapping.
- Explicit declaration imports register identities; server consumers use Definition-based Catalog lookup.
