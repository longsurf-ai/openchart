// Purpose: Retain the latest revision of every updated bar without retaining tick history.
import {
  FeedError,
  FeedReasons,
  type BarsSnapshot,
  type BarsRequest,
} from "@openchart/feed";
import { mergeByTime } from "@openchart/timeseries";
import { Option } from "effect";
import { ReplaySubject, map } from "rxjs";

type Frame = BarsSnapshot["data"];

/**
 * Keep both views in the same emission: new subscribers receive all retained
 * bars in `current`, while existing subscribers receive only the latest `update`
 * batch. ReplaySubject(1) retains this pair for late subscribers.
 */
type ReplayState = {
  // Accumulated bars after applying this batch; latest row wins per timestamp.
  readonly current: Frame;

  // Incoming batch, already included in current; may add or revise bars.
  readonly update: Frame;
};
const MAX_REPLAY_BARS = 50_000;

/**
 * Late readers receive one consolidated frame; attached readers receive original
 * live batches. ReplaySubject registers readers before replay, so reentrant updates
 * cannot fall between the checkpoint and live delivery. Completion/errors retain
 * the last accepted checkpoint. The owner stops calling next when the channel ends.
 * @internal
 */
export function createBarsReplay(provider: BarsRequest["provider"]) {
  // ReplaySubject(1) retains the last accepted checkpoint and the latest batch.
  const states = new ReplaySubject<ReplayState>(1);
  let retained = Option.none<Frame>();

  return {
    updates: states.pipe(
      map((state, index) => (index === 0 ? state.current : state.update)),
    ),
    next(update: Frame) {
      const current = retainUpdate(retained, update, provider);
      retained = Option.some(current);
      states.next({ current, update });
    },
    error: (error: unknown) => states.error(error),
    complete: () => states.complete(),
  };
}

/** Merge before publishing; overflow keeps the last valid checkpoint intact. */
function retainUpdate(
  retained: Option.Option<Frame>,
  update: Frame,
  provider: BarsRequest["provider"],
): Frame {
  const current = Option.match(retained, {
    onNone: () => update,
    // Fold each batch into the shared replay checkpoint once, keeping the latest
    // row per timestamp so returning subscribers receive one consolidated frame.
    onSome: (previous) => mergeByTime(previous, update),
  });
  if (current.numRows > MAX_REPLAY_BARS)
    throw new FeedError({
      reason: new FeedReasons.ResyncRequired({ provider }),
    });
  return current;
}
