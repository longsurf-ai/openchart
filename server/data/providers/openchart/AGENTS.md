# OpenChart Provider

`openchart.ts` owns activation; `access.ts` checks access; `datasets/` owns native
access/declarations; `feed/` adapts consumers. `client.ts` owns authenticated I/O
and decoding; `live.ts` owns the shared socket and series subscriptions; `contract.ts` defines results; `config.ts`/`errors.ts` own settings/failures.

- Cloud admission grants access; confirmed billing facts explain denials.
  HTTP 403 alone never implies a subscription requirement.
- Publish Datasets only while enabled and access is granted. Requirements and
  permission errors wait for account/billing refresh or explicit retry; transient
  failures use shared recovery. Ordinary retirement drains accepted updates.
- Access owns credentials. Runtime injects client reset into Auth; account writes
  cancel old work before returning.
- Resolve Integration credentials per request/handshake. Tokens stay in
  Authorization headers; redirects never forward them elsewhere.
- Endpoints require HTTPS or development HTTP loopback without credentials,
  query or fragment. Deadlines are positive and cover credentials and bodies.
- Reset cancels credential acquisition, HTTP and sockets, invalidates buffered
  values and publishes readiness changes. Disposal is final.
- One client owns at most one Cloud socket; identical complete series share one
  subscription. Connect, acknowledge and buffer before history reads. Last consumer
  releases its subscription; last subscription closes the socket. Wait for physical
  closure before reconnecting. Caller Scope releases its consumer; overflow fails
  only the slow consumer. Retirement drains accepted data.
- Preserve typed resynchronization requests for server close codes 1012/1013.
  Client owns endpoint paths, parameters, JSON/Arrow decoding, units and response
  identity checks.
  Datasets own complete pagination/DataFrames; Feed owns routing and history windows.
