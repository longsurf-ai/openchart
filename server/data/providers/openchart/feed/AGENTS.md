# OpenChart Feed adapters

Owns exact-Definition bindings and consumer adaptation, without acquiring
resources at construction. Preserve native identities and DataFrame columns.

- `bars.ts` preserves the requested price basis across history/live. History
  supplies finalized bars; buffered updates cannot revise any finalized history bar.
  Updates keep monotonic time/asOf and irreversible finality.
- Renewal runs only on `Dataset.StreamInterrupted` with kind `resync`: it opens
  live first, fills missing history, then drains buffered updates. Committed bars
  remain immutable; other failures and cancellation propagate.
- `symbology.ts` maps native listings; generic Feed owns routing and search policy.
