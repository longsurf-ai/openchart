# Calendar Feed

Owns the consumer Calendar service contract and its currently unavailable implementation.

## Invariants

- Dataset calendar access is distinct from resolving a consumer listing's venue
  calendar. Until a Feed adaptor exists, operations fail unavailable.
- No placeholder router, adaptor or provisioner is created for future work.
