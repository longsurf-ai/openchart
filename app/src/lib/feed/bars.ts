// Purpose: Own one cancellable Bars channel, retain its stopped view for display, and share open live views.
import {
  ClientFailures,
  FeedError,
  FeedReasons,
  type BarsSnapshot,
  type BarsMessage,
  type BarsRequest,
} from "@openchart/feed";
import {
  Observable,
  ReplaySubject,
  catchError,
  defer,
  filter,
  finalize,
  map,
  of,
  share,
  tap,
  throwError,
  timer,
} from "rxjs";

import type { BarsView } from "./contracts";

/**
 * Emit the snapshot once; later bars go only to view.updates. Unsubscribing stops
 * the channel and completes updates, retaining bounded replay for a static view.
 * Each subscription owns a separate channel; subscribing to updates opens none.
 * Out-of-order messages are an InvalidResponse; replay overflow asks for a resync.
 * @example const subscription = observeBars(messages, request).subscribe(showView);
 */
export function observeBars(
  messages: Observable<BarsMessage>,
  request: BarsRequest,
): Observable<BarsView> {
  return defer(() => {
    const updates = new ReplaySubject<BarsSnapshot["data"]>();
    let receivedSnapshot = false;
    let points = 0;
    return messages.pipe(
      tap({
        next: (message) => {
          if (message.type === "snapshot") {
            if (receivedSnapshot) throw new ClientFailures.InvalidResponse();
            receivedSnapshot = true;
            return;
          }
          if (!receivedSnapshot || request.to !== "now")
            throw new ClientFailures.InvalidResponse();
          points += message.data.numRows;
          if (points > 50_000)
            throw new FeedError({
              reason: new FeedReasons.ResyncRequired({
                provider: request.provider,
              }),
            });
          updates.next(message.data);
        },
        complete: () => {
          if (!receivedSnapshot) throw new ClientFailures.InvalidResponse();
        },
      }),
      filter((message) => message.type === "snapshot"),
      map(({ snapshot }) =>
        Object.freeze({
          ...snapshot,
          request,
          range: Object.freeze({ ...snapshot.range }),
          updates: updates.asObservable(),
        }),
      ),
      catchError((error) => {
        updates.error(error);
        return throwError(() => error);
      }),
      finalize(() => updates.complete()),
    );
  });
}

/** How long an unwatched live view stays open for reuse; matches React Query's default gcTime. */
export const BARS_KEEP_MS = 5 * 60_000;

/**
 * Share open live views, so a chart that remounts (for example after switching
 * Dashboards) reattaches instead of reloading. A request reuses the newest open
 * view with the same series and end when that view starts no later and asks for
 * at least as many bars; its replayed updates cover the time in between.
 * Otherwise a new channel opens and becomes the newest view.
 *
 * The newest view stays open {@link BARS_KEEP_MS} after its last subscriber leaves; a
 * replaced view closes as soon as it is unwatched. Views that fail or finish,
 * including every historical window, are never reused.
 * @example const observe = shareBarsViews((request) => openChannel(request));
 */
export function shareBarsViews(
  open: (request: BarsRequest) => Observable<BarsView>,
): (request: BarsRequest) => Observable<BarsView> {
  const newest = new Map<
    string,
    { request: BarsRequest; view$: Observable<BarsView> }
  >();
  return (request) => {
    const { from, countBack, ...seriesAndEnd } = request;
    const key = JSON.stringify(seriesAndEnd);
    const found = newest.get(key);

    // Request should be subset of what we have.
    if (
      found &&
      found.request.from <= from &&
      found.request.countBack >= countBack
    )
      return found.view$;
    const isNewest = () => newest.get(key)?.view$ === view$;
    const view$: Observable<BarsView> = open(request).pipe(
      finalize(() => {
        if (isNewest()) newest.delete(key);
      }),
      share({
        connector: () => new ReplaySubject<BarsView>(1),
        resetOnRefCountZero: () =>
          isNewest() ? timer(BARS_KEEP_MS) : of(true),
      }),
    );
    newest.set(key, { request, view$ });
    return view$;
  };
}
