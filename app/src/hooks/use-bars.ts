// Purpose: Switch Bars subscriptions and choose whether loading retains the previous view.
import type {
  BarsRequest,
  BarsCapabilities,
  ClientFailure,
  FeedError,
} from "@openchart/feed";
import type { ProviderListing } from "@openchart/market";
import { hashKey, useQuery } from "@tanstack/react-query";
import {
  useObservable,
  useObservableCallback,
  useObservableState,
} from "observable-hooks";
import { useMemo } from "react";
import {
  EMPTY,
  catchError,
  concat,
  defer,
  distinctUntilChanged,
  map,
  of,
  retry as retryObservation,
  scan,
  startWith,
  switchMap,
  throwError,
  timer,
} from "rxjs";

import {
  sameBarsRequest,
  type UseBarsOptions,
  type UseBarsResult,
} from "@openchart/app/lib/feed/contracts";
import { feedError } from "@openchart/app/lib/feed/transport";

import { useDatafeed, useFeedVersion } from "./use-datafeed";

export type {
  BarsView,
  UseBarsOptions,
  UseBarsResult,
} from "@openchart/app/lib/feed/contracts";

/** Gate a finite query without inventing a domain request. */
export interface QueryOptions {
  readonly enabled?: boolean;
}

/**
 * Load one chart window. Change the request to pan, zoom, or jump to another time.
 * Requires a FeedProvider; the hook opens and closes its own data subscription.
 *
 * ```text
 * Chart pan / zoom / jump
 *          |
 *          v
 *     setRequest(...) -> useBars(request)
 *                             |
 *                             +-- status / error -> React UI
 *                             +-- current.data -> install DataFrame columns
 *                             +-- current.updates -> apply later DataFrames
 * ```
 *
 * The chart shows A. The user requests B, for example switching BTC to ETH.
 * For two live requests:
 * ```text
 *                  User requests B
 *                         |
 *                Stop A's subscription
 *                Load B (status: loading)
 *                         |
 *             +-----------+-----------+
 *             |                       |
 *       keep (default)              clear
 *       Leave A on screen           Empty the chart
 *       A no longer updates
 *             |                       |
 *             +-----------+-----------+
 *                         |
 *                 B's snapshot arrives
 *                 Show B (status: ready)
 *                 Apply B's live updates
 * ```
 * On the first load there is no A, so both modes start with an empty chart.
 * The same switch applies to any window, ticker, resolution, or client change.
 * 'keep' is the default. Changing keep/clear alone does not fetch.
 *
 * - B fails before its snapshot: status is error; keep shows A, clear stays empty.
 * - Stream fails after its snapshot: status is error; its view stays visible.
 * - Stream ends normally: keep the view and ready status.
 * - Retryable live failures reopen with exponential backoff from 1 to 30 seconds.
 *   Keep the failure visible until a valid snapshot arrives; a snapshot resets
 *   backoff. Historical requests and non-retryable failures wait for user action.
 * - retry(): cancel pending backoff and reopen the latest request immediately.
 *   Changing the request/client or unmounting also cancels pending retries.
 * - Unmount: release the channel. The client keeps a live one open for 5 minutes,
 *   so a remount (for example returning to a Dashboard) reattaches without reloading.
 *
 * current.data and each update are DataFrames with the source columns and labels.
 * Install data first, then subscribe to updates. Updates replay in order; they
 * do not mutate the snapshot or trigger React renders. Use current.request to label the bars, even while B is loading.
 *
 * How it works (observable-hooks connects this RxJS flow to React):
 * ```text
 * request/client -> distinctUntilChanged: skip equal inputs
 *                         |
 * retry() ----------------+
 *                         v
 *                    switchMap: stop old channel, open new
 *                         |
 *                         v
 *                    scan: keep last view for display
 * ```
 *
 * @param request - Series + [from, to) in epoch milliseconds; to: 'now' adds live
 * updates. countBack asks for at least N bars when history exists, extending
 * before from if needed. It never cuts bars from the requested window.
 * @param options - loadingBehavior: 'keep' (default) or 'clear', as shown above.
 * @returns status, current (when available), error (on failure), and retry().
 * current.range is the actual snapshot range; hasMoreBefore means older bars exist.
 *
 * @example Historical window; series is the caller's selected BarsSeries.
 * ```tsx
 * const bars = useBars({
 *   ...series,
 *   from: Date.parse('2026-09-01T00:00:00Z'),
 *   to: Date.parse('2026-09-02T00:00:00Z'),
 *   countBack: 500,
 * }, {loadingBehavior: 'clear'});
 * // bars.current?.updates completes without live batches.
 * // Show bars.error when bars.status === 'error'; retry with bars.retry().
 * ```
 *
 * @example Live chart; series is the caller's selected BarsSeries.
 * ```tsx
 * const [request, setRequest] = useState<BarsRequest>(() => ({
 *   ...series, from: Date.now() - 86_400_000, to: 'now', countBack: 500,
 * }));
 * const bars = useBars(request); // Keep the stopped view during the next load.
 * const onWindowChange = (window: Pick<BarsRequest, 'from' | 'to' | 'countBack'>) =>
 *   setRequest(previous => ({...previous, ...window}));
 * // Pass onWindowChange to the chart's pan/zoom/jump callback.
 * // Numeric to switches to history; 'now' returns to live updates.
 * ```
 *
 * @example Send the view to your renderer, including a kept view while loading.
 * replaceFrame/applyFrame are your renderer's stable callbacks. replaceFrame
 * clears on undefined; applyFrame updates columns at each row's time timestamp.
 * ```tsx
 * const bars = useBars(request);
 * const current = bars.current;
 * useEffect(() => {
 *   replaceFrame(current?.data);
 *   const subscription = current?.updates.subscribe({
 *     next: frame => applyFrame(frame),
 *     error: () => {}, // The hook exposes this failure as bars.error.
 *   });
 *   return () => subscription?.unsubscribe();
 * }, [current, replaceFrame, applyFrame]);
 * ```
 */
export function useBars(
  request: BarsRequest,
  options: UseBarsOptions = {},
): UseBarsResult {
  const client = useDatafeed();
  const [retry, retries$] = useObservableCallback();
  const state$ = useObservable(
    (inputs$) =>
      inputs$.pipe(
        distinctUntilChanged(
          ([oldClient, oldRequest], [client, request]) =>
            oldClient === client && sameBarsRequest(oldRequest, request),
        ),
        switchMap(([client, request, retries$, retry]) =>
          retries$.pipe(
            startWith(undefined),
            switchMap(() => {
              let failures = 0;
              return defer(() => client.bars.observe(request)).pipe(
                map((current): UseBarsResult => {
                  failures = 0;
                  return { status: "ready", current, retry };
                }),
                catchError((error) => {
                  const failure = feedError(error);
                  return concat(
                    of({
                      status: "error",
                      current: undefined,
                      error: failure,
                      retry,
                    } satisfies UseBarsResult),
                    throwError(() => failure),
                  );
                }),
                retryObservation({
                  delay: (error: FeedError | ClientFailure) =>
                    request.to === "now" && error.isRetryable
                      ? timer(
                          Math.min(1000 * 2 ** Math.min(failures++, 5), 30_000),
                        )
                      : EMPTY,
                }),
              );
            }),
            startWith({
              status: "loading",
              current: undefined,
              retry,
            } satisfies UseBarsResult),
          ),
        ),
        map((result) => ({ result, placeholder: result.status === "loading" })),
        // Retain only data. switchMap has already stopped the old channel.
        scan((previous, next) =>
          next.result.status === "ready"
            ? next
            : {
                result: { ...next.result, current: previous.result.current },
                placeholder: next.placeholder || previous.placeholder,
              },
        ),
      ),
    [client, request, retries$, retry],
  );
  const initial: UseBarsResult = {
    status: "loading",
    current: undefined,
    retry,
  };
  const { result, placeholder } = useObservableState(state$, {
    result: initial,
    placeholder: true,
  });
  const behavior = options.loadingBehavior ?? "keep";
  return useMemo(
    () =>
      placeholder && behavior === "clear" && result.status !== "ready"
        ? { ...result, current: undefined }
        : result,
    [result, placeholder, behavior],
  );
}
/** Query/cache capabilities for this exact provider and listing. While a new Feed
 * version re-reads them, the same provider and listing keep their previous answer,
 * so callers never fall back to loading; another listing never sees it.
 * @example const caps = useBarsCapabilities({provider, listing}); */
export function useBarsCapabilities(
  request: ProviderListing,
  options: QueryOptions = {},
) {
  const client = useDatafeed();
  const version = useFeedVersion();
  return useQuery<BarsCapabilities, FeedError | ClientFailure>({
    queryKey: [version, "bars", "capabilities", request],
    // Let old queries settle in their old cache entry when the version changes.
    queryFn: () => client.bars.getCapabilities(request),
    placeholderData: (previous, previousQuery) =>
      previousQuery !== undefined &&
      hashKey([previousQuery.queryKey[3]]) === hashKey([request])
        ? previous
        : undefined,
    enabled: version !== undefined && options.enabled !== false,
  });
}
