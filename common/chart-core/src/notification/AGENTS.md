# notification

Generic notification event contracts shared by producers and fan-in consumers.

## Invariants

- `Notification.CreateEvent.idempotencyKey` is required; producers must choose a stable key before any user-visible side effect is materialized.
