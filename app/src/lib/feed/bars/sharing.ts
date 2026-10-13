// Purpose: Reuse covering live Bars channels and release idle channels after a grace period.
import type { BarsRequest } from "@openchart/feed";
import { MutableHashMap, Option } from "effect";
import { Observable, ReplaySubject, finalize, of, share, timer } from "rxjs";
import type { BarsView } from "../contracts";

/** How long an unwatched live view stays open for reuse; matches React Query's default gcTime. */
export const BARS_KEEP_MS = 5 * 60_000;

type SharedView = {
  readonly request: BarsRequest;
  readonly view$: Observable<BarsView>;
};

/**
 * Share the newest open view covering the requested series, end, start and count.
 * Remounts reuse its snapshot and compacted updates without opening another channel.
 * The newest view stays open for BARS_KEEP_MS after its last subscriber leaves;
 * replaced views close immediately when unwatched. Failed or finished views,
 * including finite history, are never reused. Unsubscribe releases one reader.
 * @example const observe = shareBarsViews((request) => openChannel(request));
 */
export function shareBarsViews(
  open: (request: BarsRequest) => Observable<BarsView>,
): (request: BarsRequest) => Observable<BarsView> {
  const newest = MutableHashMap.empty<string, SharedView>();
  return (request) => {
    const { from, countBack, ...seriesAndEnd } = request;
    const key = JSON.stringify(seriesAndEnd);
    const found = MutableHashMap.get(newest, key);
    if (
      Option.isSome(found) &&
      found.value.request.from <= from &&
      found.value.request.countBack >= countBack
    )
      return found.value.view$;

    const isNewest = () =>
      Option.exists(
        MutableHashMap.get(newest, key),
        (entry) => entry.view$ === view$,
      );
    const view$: Observable<BarsView> = open(request).pipe(
      finalize(() => {
        if (isNewest()) MutableHashMap.remove(newest, key);
      }),
      share({
        connector: () => new ReplaySubject<BarsView>(1),
        resetOnRefCountZero: () =>
          isNewest() ? timer(BARS_KEEP_MS) : of(true),
      }),
    );
    MutableHashMap.set(newest, key, { request, view$ });
    return view$;
  };
}
