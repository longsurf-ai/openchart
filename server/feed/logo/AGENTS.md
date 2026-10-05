# Logo Feed

Owns the consumer contract and provisioning from registered Provider adapters.

- `logo.ts` selects exact Dataset bindings without owning resources. Availability
  participates in the committed Feed version; absent sources fail unavailable.
- Providers own identifier interpretation, candidate matching and image bytes.
  The bundled Provider adapter returns a logo only for a unique confident match;
  ambiguous/unknown matches return null and source failures remain failures.
- Frontend passes an identifier and renders the URL; it never interprets suffixes.
