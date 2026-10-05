# credential

Owns Integration's credential storage.

- `credential.ts` owns Key/OAuth storage. Records use `integrationID`; OAuth
  requires `methodID`. Credential imports Integration's schemas, never implementation.
- `create` atomically replaces one integration's credentials. Failure preserves
  the old value; other integrations are untouched. `update` preserves ID and
  integration identity. `clear(integrationID)` deletes current credentials without reading secrets.
- `active` is a required persisted boolean, initially true. `setActive` preserves
  ciphertext without decrypting; `list` filters active in SQL before decryption.
- Store complete values, including metadata, as ciphertext in Database.
  Hosts inject Promise methods: encrypt/decrypt. Missing
  encryption rejects secret reads/writes; enablement/removal remain available. Never use
  plaintext fallback. SQL, codec, and protection failures use `StorageFailed`
  without contents or causes; absence is not failure.
- `encryption.ts` uses jose JWE with a host-owned 32-byte key; shared code never imports Electron. Hosts
  retain keys across restarts, outside the database and ordinary config.
  Secrets never become Resource entities, tRPC responses, or event payloads.
- Integration owns authorization and renewal; providers own metadata schemas.
  Credential performs no network I/O or background work.
- Malformed bound values fail reads; unbound legacy rows remain ignored. The
  encryption migration retires old plaintext credentials; no lazy upgrades.
- Tests exercise public Services with isolated SQLite.
