# event

Unified time-anchored Event contract for agent and user-authored explanation facts.

## Invariants

- Market identity is `market: ProviderListing` from OpenChart; provider + symbol
  distinguish listings. Never require or fabricate V1 numeric listing IDs.

- No rendering lives here; Events surface through dashboard/listing-scoped ChartAnnotations.
- Every Event has one required dashboard/listing scope and creator. Provider evidence belongs in Event metadata, not a parallel public Event branch.
- Event metadata stores raw evidence references. `sourcePreviews` is the optional read projection that may carry hydrated document content and discriminated source identity for rendering.
