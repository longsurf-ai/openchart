# integration

Owns registration, credential selection, OAuth attempts, and renewal.

- `integration.ts` owns Service/configuration; `id.ts` stays pure; `layer.ts` owns
  implementation. Contract uses type-only Credential imports; no Layer re-export.
- Registrations preserve order. Integration alone calls Credential; never depends on Auth/OpenChartClient.
  OAuth refresh uses explicit methodID.
- Resolve only active credentials by IntegrationID. Inactive records cannot
  resolve or refresh; internal getSavedCredential can read them for restoration.
  setActive persists local enablement without remote validation or decryption;
  disconnect still deletes credentials.
- Refresh on resolution near expiry. Missing refresh implementations return stored
  values; failures preserve them. No timer or coalescing policy.
- A synchronized attempt map arbitrates completion/cancellation/expiry. One
  application-scoped callback fiber owns each attempt Scope and uninterruptible
  settlement survives request exit. Claim/fork is atomic.
- Cancelled/expired attempts cannot persist late results. Save credentials before
  complete; storage failure reports failed, preserves prior credentials, and cleans
  up. Never interrupt between persistence and terminal state.
- Expiry/scrubbing are application-scoped. Disposal awaits cleanup before dependencies close.
- Credential writes publish one `integration.updated` invalidation after storage;
  payloads contain no secrets. Registration publishes nothing.
- Public writes accept third-party IDs only; Auth owns account writes.
  OAuth, setActive, and secret reads stay internal; tests use isolated SQLite.
