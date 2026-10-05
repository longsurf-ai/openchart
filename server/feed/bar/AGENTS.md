# Bar Feed

Owns Bars service, shared history reads, provider routing and Hose handling.

- service.ts observe returns snapshot/optional updates in the caller's Scope;
  closing it stops the source.
- Preserve native DataFrame columns, labels, and NaN/null gaps through history
  and observation. Timeseries owns selection/concatenation/encoding; never convert
  to Bar rows. Encode shared BarsMessage before Hose delivery.
- history.ts owns full-window reads and backward countBack/probe composition.
  Start both native reads together; source failures never become truncated
  success. Preserve correction metadata and expanded-range filtering. Dataset
  count semantics stay unchanged.
- history-cache.ts reuses complete spans per series within one ready Dataset,
  behind admission. Effect owns TTL/capacity and per-series serialization;
  failed/cancelled fills never commit. Providers define retention/finality and
  fresh tails; replacement, account invalidation and resync cannot reuse stale spans.
- provisioner.ts selects Provider-owned bindings by exact Definition identity, never
  field matching, cross-provider mapping, or fallback. It acquires no resources
  and requires continuation for live requests.
- hose-handler.ts owns parsing and snapshot/update framing; server/index.ts
  registers it through generic Hose routing. No separate Bars tRPC router.
- History/live handoff buffers and orders corrections; discontinuities fail
  explicitly. Intentional source completion sends Hose done. Caller scopes cancel
  work; Feed replacement never revokes accepted requests or returned services.
