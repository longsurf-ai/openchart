// Purpose: Select useful example windows from packaged real bars using the actual study outputs.
// From v2: node server/indicators/select-study-windows.ts --verify (or --write to reselect).
// endTime is exclusive epoch milliseconds; preceding captured bars remain study warmup.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Schema } from "effect";
import { Field, Int64, Schema as ArrowSchema } from "apache-arrow";
import { from } from "rxjs";
import { DataStream, tea, timeframeClock, type Datum, type Node } from "tea";

const studies = {
  "supertrend-regime": ["turn_up", "turn_down"],
  "bollinger-squeeze": ["squeeze_start", "up_expansion", "down_expansion"],
  "rsi-divergence": ["bear_confirmed", "bull_confirmed"],
  "anchored-vwap-bands": ["anchor"],
  "money-flow-pressure": ["positive", "negative"],
  "confirmed-swing-map": [
    "higher_high",
    "lower_high",
    "higher_low",
    "lower_low",
  ],
} as const;
type StudyId = keyof typeof studies;
const directory = new URL(
  "../../app/src/features/chart/assets/market-examples/",
  import.meta.url,
);
const Manifest = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    symbol: Schema.String,
    year: Schema.Number,
  }),
);
const Capture = Schema.Struct({
  id: Schema.String,
  displayRange: Schema.Struct({ from: Schema.Finite, to: Schema.Finite }),
  bars: Schema.Array(
    Schema.Tuple([
      Schema.Finite,
      Schema.Finite,
      Schema.Finite,
      Schema.Finite,
      Schema.Finite,
      Schema.Finite,
    ]),
  ),
});
const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(
  await readFile(new URL("manifest.json", directory), "utf8"),
);
const examples = await Promise.all(
  manifest.map(async (entry) => ({
    ...entry,
    ...Schema.decodeUnknownSync(Schema.fromJsonString(Capture))(
      await readFile(new URL(`${entry.id}.json`, directory), "utf8"),
    ),
  })),
);
type Example = (typeof examples)[number];
type Event = { name: string; index: number; displayIndex: number };
type Segment = {
  output: string;
  startTime: number;
  endTime: number;
  startValue: number;
  endValue: number;
  confirmedIndex: number;
};
type Candidate = {
  exampleId: string;
  symbol: string;
  year: number;
  endIndex: number;
  endTime: number;
  score: number;
  cardEvents: Event[];
  heroEvents: Event[];
  latestSegments: Omit<Segment, "confirmedIndex">[];
};
const write = process.argv.includes("--write");
const verify = process.argv.includes("--verify");
assert(!(write && verify));
assert(
  process.argv
    .slice(2)
    .every((argument) => argument === "--write" || argument === "--verify"),
);
const fixedSelections = verify
  ? Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Record(
          Schema.String,
          Schema.Struct({ exampleId: Schema.String, endTime: Schema.Finite }),
        ),
      ),
    )(await readFile(new URL("study-windows.json", directory), "utf8"))
  : undefined;

async function execute(
  node: Node,
  example: Example,
  endTime = example.displayRange.to,
) {
  const rows = example.bars
    .filter(([time]) => time < endTime)
    .map(([time, open, high, low, close, volume]) => {
      const values: Record<string, number | boolean> = {
        time,
        open,
        high,
        low,
        close,
        volume,
        provisional: false,
        hl2: (high + low) / 2,
        hlc3: (high + low + close) / 3,
        ohlc4: (open + high + low + close) / 4,
        hlcc4: (high + low + 2 * close) / 4,
      };
      return {
        ...Object.fromEntries(
          node.module.inputs.schema.fields.map(({ name }) => {
            assert(Object.hasOwn(values, name), `Unavailable input ${name}`);
            return [name, values[name]];
          }),
        ),
        time: BigInt(time),
        provisional: false,
      };
    });
  const inputSchema = new ArrowSchema([
    ...node.module.inputs.schema.fields,
    new Field("time", new Int64(), false),
  ]);
  const run = node.bind(
    new DataStream(inputSchema, from(rows), timeframeClock("D")),
  );
  const output: Datum[] = [];
  try {
    await new Promise<void>((resolve, reject) =>
      run.to({
        next: (row) => output.push(row),
        error: reject,
        complete: resolve,
      }),
    );
  } finally {
    run.dispose();
  }
  assert.equal(output.length, rows.length);
  return output;
}

function markerEvents(id: StudyId, output: readonly Datum[]): Event[] {
  return output.flatMap((row, index) =>
    studies[id].flatMap((name) => {
      const shape = row[name] as { series: boolean; offset: number } | null;
      return shape?.series === true
        ? [{ name, index, displayIndex: index + shape.offset }]
        : [];
    }),
  );
}

function rowSegments(
  id: StudyId,
  row: Datum,
): Omit<Segment, "confirmedIndex">[] {
  const names =
    id === "rsi-divergence"
      ? ["bear_price", "bear_momentum", "bull_price", "bull_momentum"]
      : id === "confirmed-swing-map"
        ? ["swing"]
        : [];
  return names.flatMap((name) => {
    const segment = row[name] as {
      start_time: number | bigint | null;
      end_time: number | bigint | null;
      start_value: number;
      end_value: number;
    } | null;
    if (!segment || segment.start_time === null || segment.end_time === null)
      return [];
    const startTime = Number(segment.start_time);
    const endTime = Number(segment.end_time);
    return [startTime, endTime, segment.start_value, segment.end_value].every(
      Number.isFinite,
    )
      ? [
          {
            output: name,
            startTime,
            endTime,
            startValue: segment.start_value,
            endValue: segment.end_value,
          },
        ]
      : [];
  });
}

function visibleSegments(
  id: StudyId,
  output: readonly Datum[],
  fromTime: number,
): Segment[] {
  const unique = new Map<string, Segment>();
  output.forEach((row, confirmedIndex) => {
    for (const segment of rowSegments(id, row)) {
      if (segment.endTime < fromTime) continue;
      const key = JSON.stringify(segment);
      if (!unique.has(key)) unique.set(key, { ...segment, confirmedIndex });
    }
  });
  return [...unique.values()];
}

const rankings: Partial<Record<StudyId, Candidate[]>> = {};
const nodes = new Map<StudyId, Node>();
try {
  for (const id of Object.keys(studies) as StudyId[]) {
    let node: Node;
    try {
      const source = await readFile(
        new URL(`./builtins/${id}.tea`, import.meta.url),
        "utf8",
      );
      node = tea`${source}`;
      nodes.set(id, node);
    } catch (error) {
      if (verify) throw error;
      console.error(`${id}: ${String(error)}`);
      continue;
    }
    const candidates: Candidate[] = [];
    const fixed = fixedSelections?.[id];
    if (verify) assert(fixed, `${id} needs a selected window`);
    for (const example of examples) {
      if (fixed && fixed.exampleId !== example.id) continue;
      const output = await execute(node, example, fixed?.endTime);
      const events = markerEvents(id, output);
      for (
        let endIndex = fixed ? output.length - 1 : 79;
        endIndex < output.length;
        endIndex++
      ) {
        const time = example.bars[endIndex]![0];
        if (
          time >= example.displayRange.to ||
          example.bars[endIndex - 79]![0] < example.displayRange.from
        )
          continue;
        const heroEvents = events.filter(
          (event) =>
            event.index <= endIndex && event.displayIndex > endIndex - 80,
        );
        const cardEvents = heroEvents.filter(
          (event) => event.displayIndex > endIndex - 50,
        );
        if (
          cardEvents.length < 1 ||
          cardEvents.length > 3 ||
          // Swing structure needs four labels to show LL → LH → HL → HH.
          heroEvents.length > (id === "confirmed-swing-map" ? 4 : 3)
        )
          continue;
        const kinds = new Set(heroEvents.map(({ name }) => name));
        if (id === "supertrend-regime" && kinds.size < 2) continue;
        if (
          id === "bollinger-squeeze" &&
          !heroEvents.some(({ name }) => name.endsWith("expansion"))
        )
          continue;
        const newest = endIndex - cardEvents.at(-1)!.displayIndex;
        if (newest < 5 || newest > 22) continue;
        const oldest = cardEvents[0]!.displayIndex - (endIndex - 50);
        const prices = example.bars
          .slice(endIndex - 49, endIndex + 1)
          .map((bar) => bar[4]);
        const movement =
          (Math.max(...prices) - Math.min(...prices)) / Math.min(...prices);
        const score =
          100 -
          Math.abs(cardEvents.length - 2) * 12 -
          Math.abs(heroEvents.length - 3) * 5 -
          Math.abs(newest - 12) -
          (oldest < 8 ? 10 : 0) +
          Math.min(20, movement * 40);
        const latestSegments = rowSegments(id, output[endIndex]!);
        if (
          (id === "rsi-divergence" || id === "confirmed-swing-map") &&
          !latestSegments.some(
            (segment) =>
              segment.startTime >= example.bars[endIndex - 49]![0] &&
              segment.endTime <= time,
          )
        )
          continue;
        candidates.push({
          exampleId: example.id,
          symbol: example.symbol,
          year: example.year,
          endIndex,
          endTime: example.bars[endIndex + 1]?.[0] ?? example.displayRange.to,
          score,
          cardEvents,
          heroEvents,
          latestSegments,
        });
      }
    }
    rankings[id] = candidates.sort(
      (a, b) =>
        b.score - a.score ||
        a.exampleId.localeCompare(b.exampleId) ||
        a.endTime - b.endTime,
    );
    console.log(
      JSON.stringify({
        study: id,
        candidates: candidates.length,
        top: rankings[id]!.slice(0, 5),
      }),
    );
  }
  const selected: Partial<
    Record<StudyId, { exampleId: string; endTime: number }>
  > = {};
  const symbols = new Set<string>();
  const years = new Map<number, number>();
  for (const id of Object.keys(studies) as StudyId[]) {
    const candidate = rankings[id]?.find(
      (item) => !symbols.has(item.symbol) && (years.get(item.year) ?? 0) < 3,
    );
    if (!candidate) continue;
    const example = examples.find(({ id }) => id === candidate.exampleId)!;
    const output = await execute(nodes.get(id)!, example, candidate.endTime);
    assert.equal(output.length, candidate.endIndex + 1);
    const events = markerEvents(id, output).filter(
      (event) => event.displayIndex > candidate.endIndex - 80,
    );
    assert.deepEqual(
      events,
      candidate.heroEvents,
      `${id} must be reproducible without future bars`,
    );
    assert.deepEqual(
      rowSegments(id, output.at(-1)!),
      candidate.latestSegments,
      `${id} geometry must be reproducible without future bars`,
    );
    const segments = visibleSegments(
      id,
      output,
      example.bars[candidate.endIndex - 79]![0],
    );
    for (const segment of segments)
      assert(
        segment.endTime <= example.bars[segment.confirmedIndex]![0],
        `${id} must not draw a future endpoint`,
      );
    selected[id] = { exampleId: example.id, endTime: candidate.endTime };
    symbols.add(candidate.symbol);
    years.set(candidate.year, (years.get(candidate.year) ?? 0) + 1);
    console.log(
      JSON.stringify({
        selected: id,
        ...candidate,
        lastBar: new Date(example.bars[candidate.endIndex]![0]).toISOString(),
        signalDates: events.map(({ name, index }) => ({
          name,
          date: new Date(example.bars[index]![0]).toISOString(),
        })),
        segmentCount: segments.length,
        segments,
      }),
    );
  }
  if (write || verify) {
    assert.equal(
      Object.keys(selected).length,
      Object.keys(studies).length,
      "Every flagship needs a verified window",
    );
  }
  if (write) {
    await writeFile(
      new URL("study-windows.json", directory),
      `${JSON.stringify(selected, null, 2)}\n`,
    );
  }
} finally {
  for (const node of nodes.values()) node.dispose();
}
