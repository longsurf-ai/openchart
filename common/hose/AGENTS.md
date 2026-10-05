# hose

Payload-agnostic WebSocket transport. Protocol spec: [README](README.md).
Design: [Hose architecture](../../docs/architecture/hose.md).

- Routers are module-scoped, stateless: exact nonempty body.type; duplicates
  fail. Handlers own body schemas.
- Browser exports never load Node/ws. HoseServer owns sockets and one context
  per connection; context failure closes only that socket, cause hidden.
  Host-owned `authorize` answers 401 first.
- Dispose Hose before caller-owned HTTP. Teardowns run once despite sibling
  failures or synchronous finish.
- One byte-bounded queue multiplexes channels fairly; overflow closes the slow
  client. Accepted messages never send twice; adapter false means dropped.
- Bodies stay unknown, never undefined. Errors: `failed` plus owner body, or a
  bare Hose code; no text. Import no application contracts or auth policy.
- Clients may send `data` on open channels. `Channel.onData` holds one
  synchronous listener, no queue: unheard data and unknown ids drop, a
  throwing listener fails its channel. Inbound messages over 1 MiB close the
  socket (1009).
- `openChannel` returns `{send, close}`; sends queue behind an unsent open and
  throw after the end. observe/request are cold receive-only facades, one
  channel per subscriber; unsubscribe closes it; abort, disconnect and empty
  requests fail. Release listeners even for synchronous/pre-aborted calls.
- Reconnect restores sockets, not channels or data.
