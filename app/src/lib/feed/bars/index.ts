// Purpose: Adapt one owned Bars channel to the app's snapshot/update Observable contract.
import type { BarsMessage, BarsRequest } from "@openchart/feed";
import { Option } from "effect";
import {
  Observable,
  catchError,
  defer,
  filter,
  finalize,
  map,
  tap,
  throwError,
} from "rxjs";
import type { BarsView } from "../contracts";
import { createBarsChannel } from "./channel";

export { BARS_KEEP_MS, shareBarsViews } from "./sharing";

/**
 * Emit one immutable snapshot and expose compacted replay followed by live updates.
 * Each subscription owns its input channel; subscribing to updates opens none.
 * Unsubscribe stops ingestion, retaining the final accepted bars for late readers.
 * Invalid message order fails the channel. Replay overflow fails before dropping bars.
 * @example const subscription = observeBars(messages, request).subscribe(showView);
 */
export function observeBars(
  messages: Observable<BarsMessage>,
  request: BarsRequest,
): Observable<BarsView> {
  return defer(() => {
    const channel = createBarsChannel(request);
    return messages.pipe(
      map(channel.receive),
      filter(Option.isSome),
      map((view) => view.value),
      tap({ complete: channel.finish }),
      catchError((error) => {
        channel.fail(error);
        return throwError(() => error);
      }),
      finalize(channel.close),
    );
  });
}
