// Purpose: Opt-in public-Node measurements for full-size pencil strokes, without Feed or network access.
// Run: just --command node --expose-gc --import tsx server/alert/drawing-boundary-benchmark.ts
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Drawing } from "@openchart/chart-core/drawing/types";
import { drawingBoundary } from "@openchart/chart-core/drawing/boundary";
import {
  Bool,
  Field,
  Float64,
  Schema,
  TimestampMillisecond,
} from "apache-arrow";
import { Subject } from "rxjs";
import { createNode, DataStream, pineBuiltinSupplier, tea } from "tea";
import {
  drawingBoundarySource,
  MAX_DRAWING_BOUNDARY_ANCHORS,
} from "./drawing-boundary-source";

assert(global.gc, "Run with --expose-gc to measure retained memory");
const start = Date.UTC(2026, 8, 24);
const step = 60_000;
const schema = new Schema([
  new Field("time", new TimestampMillisecond(), false),
  new Field("close", new Float64(), false),
  new Field("high", new Float64(), false),
  new Field("low", new Float64(), false),
  new Field("provisional", new Bool(), false),
]);
for (const size of process.argv.slice(2).map(Number).filter(Number.isFinite)
  .length
  ? process.argv.slice(2).map(Number)
  : [100, 1000, 10000]) {
  const stress = process.env.GEOMETRY_STRESS === "1";
  const times = Array.from(
    { length: size },
    (_, index) =>
      start + (stress ? (index % 2 === 0 ? 0 : 100) : 100 + index) * step,
  );
  const item = Drawing.create(
    "freehand",
    times.map((time, index) => ({
      time: time / 1000,
      price: stress ? (index % 2 === 0 ? 50 : 150) : 200 + (index % 11),
    })),
  );
  const boundary = drawingBoundary(item);
  assert(boundary);
  const source = drawingBoundarySource(boundary, times);
  const compileStart = performance.now();
  const template = tea`${source}`;
  const compileMs = performance.now() - compileStart;
  const input = new Subject<{
    time: number;
    close: number;
    high: number;
    low: number;
    provisional: boolean;
  }>();
  const node = createNode(
    template.module.bind({ op: stress ? "touching" : "crossing" }),
    pineBuiltinSupplier(() => start + 100 * step),
  ).bind(new DataStream(schema, input));
  let rows = 0;
  let failure: unknown;
  node.to({
    next: (row) => {
      rows++;
      if (!stress) assert.equal((row.alert as unknown[]).length, 0);
    },
    error: (error) => {
      failure = error;
    },
  });
  try {
    const push = (index: number) =>
      input.next({
        time: start + index * step,
        close: 100,
        high: stress ? 200 : 101,
        low: stress ? 0 : 99,
        provisional: false,
      });
    push(0);
    push(1);
    global.gc();
    const initialHeap = process.memoryUsage().heapUsed;
    const evaluationStart = performance.now();
    for (let index = 2; index < 34; index++) push(index);
    const evaluationMs = performance.now() - evaluationStart;
    global.gc();
    const middleHeap = process.memoryUsage().heapUsed;
    for (let index = 34; index < 66; index++) push(index);
    global.gc();
    const finalHeap = process.memoryUsage().heapUsed;
    if (size > MAX_DRAWING_BOUNDARY_ANCHORS) {
      assert(failure instanceof Error);
      assert.match(failure.message, /Heap allocation limit/);
      console.log(
        JSON.stringify({
          points: size,
          sourceBytes: Buffer.byteLength(source),
          compileMs,
          unsupported: failure.message,
          supportedMaximum: MAX_DRAWING_BOUNDARY_ANCHORS,
        }),
      );
      continue;
    }
    assert.equal(failure, undefined);
    assert.equal(rows, 66);
    console.log(
      JSON.stringify({
        points: size,
        sourceBytes: Buffer.byteLength(source),
        compileMs,
        msPerBar: evaluationMs / 32,
        heapAfterWarmup: initialHeap,
        heapAfter32Bars: middleHeap,
        heapAfter64Bars: finalHeap,
      }),
    );
  } finally {
    node.dispose();
    template.dispose();
    input.complete();
  }
}
