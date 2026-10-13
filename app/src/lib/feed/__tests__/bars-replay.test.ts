// Purpose: Protect compacted replay, bar continuity, and live delivery across cache revisits.
import {
  ClientFailures,
  FeedError,
  FeedReasons,
  type BarsSnapshot,
} from "@openchart/feed";
import { mergeByTime } from "@openchart/timeseries";
import { take } from "rxjs";
import { expect, it, vi } from "vitest";
import { createBarsReplay } from "../bars/replay";
import { frame, request } from "./bars.test-utils";

it("does not count repeated revisions toward the distinct-bar limit", () => {
  const replay = createBarsReplay(request.provider);
  const times = Array.from({ length: 25_001 }, (_, index) => index);
  // More than 50,000 incoming rows still represent only 25,001 distinct bars.
  replay.next(frame(3, times));
  replay.next(frame(4, times));

  const next = vi.fn<(data: BarsSnapshot["data"]) => void>();
  replay.updates.pipe(take(1)).subscribe(next);
  expect(next).toHaveBeenCalledOnce();
  expect(
    Array.from(next.mock.calls[0]![0], ({ time, close }) => [time, close]),
  ).toEqual(times.map((time) => [time, 4]));
});

it("preserves every distinct bar, corrections, gaps and native columns in one replay", () => {
  const replay = createBarsReplay(request.provider);
  const initial = frame(2, [1, 2]);
  const updates = [
    frame(3, [2, 3]),
    frame(4, [4]),
    frame(NaN, [3]),
    frame(5, [2]),
  ];
  for (const update of updates) replay.next(update);

  const received: BarsSnapshot["data"][] = [];
  replay.updates.pipe(take(1)).subscribe((data) => received.push(data));
  expect(received).toHaveLength(1);
  const compacted = received[0]!;
  expect(Array.from(compacted, (row) => row.time)).toEqual([2, 3, 4]);
  expect(compacted.labels).toEqual(initial.labels);
  expect(compacted.get(0)).toMatchObject({ close: 5, final: false, asOf: 10 });
  expect(compacted.get(1)?.close).toBeNaN();
  expect(Array.from(mergeByTime(initial, compacted))).toEqual(
    Array.from(updates.reduce(mergeByTime, initial)),
  );
  expect(initial.get(1)?.close).toBe(2);
  expect(updates[0]!.get(0)?.close).toBe(3);
});

it("gives late subscribers one checkpoint while active subscribers keep original live batches", () => {
  const replay = createBarsReplay(request.provider);
  const early = vi.fn();
  const first = frame(3, [1]);
  const second = frame(4, [2]);
  const third = frame(5, [2]);
  const earlyReader = replay.updates.subscribe(early);
  replay.next(first);
  replay.next(second);

  const late = vi.fn();
  const lateReader = replay.updates.subscribe(late);
  expect(late).toHaveBeenCalledOnce();
  expect(Array.from(late.mock.calls[0]![0])).toEqual([
    ...Array.from(first),
    ...Array.from(second),
  ]);
  replay.next(third);
  expect(early.mock.calls.map(([data]) => data)).toEqual([
    first,
    second,
    third,
  ]);
  expect(early.mock.calls[1]![0]).toBe(second);
  expect(late).toHaveBeenCalledTimes(2);
  expect(late.mock.calls[1]![0]).toBe(third);
  earlyReader.unsubscribe();
  lateReader.unsubscribe();
});

it("does not miss a live update emitted synchronously during checkpoint delivery", () => {
  const replay = createBarsReplay(request.provider);
  replay.next(frame(3));
  const closes: number[] = [];
  const reader = replay.updates.subscribe((data) => {
    const close = data.get(0)!.close as number;
    closes.push(close);
    if (close === 3) replay.next(frame(4));
  });
  expect(closes).toEqual([3, 4]);
  reader.unsubscribe();
});

it.each(["complete", "error"] as const)(
  "replays accepted bars before a retained %s",
  (end) => {
    const replay = createBarsReplay(request.provider);
    replay.next(frame(3));
    replay.next(frame(4));
    const failure = new ClientFailures.Disconnected();
    if (end === "complete") replay.complete();
    else replay.error(failure);

    const next = vi.fn();
    const error = vi.fn();
    const complete = vi.fn();
    replay.updates.subscribe({ next, error, complete });
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]![0].get(0)?.close).toBe(4);
    if (end === "complete") expect(complete).toHaveBeenCalledOnce();
    else expect(error).toHaveBeenCalledWith(failure);
  },
);

it("rejects distinct-bar overflow before publishing or replacing the accepted checkpoint", () => {
  const replay = createBarsReplay(request.provider);
  const atLimit = frame(
    3,
    Array.from({ length: 50_000 }, (_, index) => index),
  );
  replay.next(atLimit);
  const next = vi.fn();
  const reader = replay.updates.subscribe(next);

  expect(() => replay.next(frame(4, [50_000]))).toThrow(
    new FeedError({
      reason: new FeedReasons.ResyncRequired({ provider: request.provider }),
    }),
  );
  expect(next).toHaveBeenCalledOnce();
  const late = vi.fn();
  replay.updates.pipe(take(1)).subscribe(late);
  expect(late.mock.calls[0]![0]).toBe(atLimit);
  reader.unsubscribe();
});
