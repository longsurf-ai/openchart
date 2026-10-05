// Purpose: Pin the volume profile built-ins' bar selection against the market's own bars.
import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { from, map } from "rxjs";
import {
  createNode,
  DataStream,
  pineBuiltinSupplier,
  tea,
  type Datum,
} from "tea";
import { expect, it } from "vitest";
import { BarsSeries } from "@openchart/feed";
import { marketContext } from "@openchart/server/tea/source";
import { columnSchema } from "@openchart/server/tea/wiring";

const hour = 3_600_000;
const day = 24 * hour;
const monday = Date.UTC(2026, 0, 5);

type Profile = {
  from: number;
  to: number;
  rows: { segments: { value: number; color: unknown; title: string }[] }[];
  levels: { color: unknown; title: string }[];
};

const market = Schema.decodeUnknownSync(BarsSeries)({
  provider: "yfinance",
  listing: { symbol: "MSFT", currency: "USD" },
  resolution: "1h",
  session: "regular",
  adjustment: "split",
});

// Hourly bars from Monday, two days by default; volume 1000 + i makes every
// range's total distinct, and even bars rise while odd ones fall.
const hourly = (columns: readonly string[], length: number, forming: boolean) =>
  Array.from({ length }, (_, i) => {
    const close = 100 + Math.sin(i);
    const bar: Record<string, number> = {
      open: i % 2 === 0 ? close - 0.5 : close + 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + i,
    };
    return {
      time: monday + i * hour,
      // In a live observation the newest bar may still be forming.
      provisional: forming && i === length - 1,
      ...Object.fromEntries(columns.map((name) => [name, bar[name]])),
    };
  });

const compile = async (id: string) =>
  tea`${await readFile(new URL(`./builtins/${id}.tea`, import.meta.url), "utf8")}`;

// The opening bars a period request reads: Monday's and Tuesday's, or that of
// the week or month they fall in.
const periods: Readonly<Record<string, readonly number[]>> = {
  D: [monday, monday + day],
  W: [monday],
  M: [Date.UTC(2026, 0, 1)],
};

/**
 * Run a built-in the way TeaService runs a chart's script: bound with the
 * market's facts and the `chart` resolution, the script reading `bars`
 * hourly bars, the newest still `forming` or final, and its period request,
 * if any, reading the opening bar of each day or month it asks for. As in
 * the service, each input's last history row is its newest, which the script
 * reads as `barstate.islast`. The `live` newest bars arrive after the
 * history, as live attempts of the newest bar: the forming history bar's
 * final one, then each bar forming and, but the newest, final. Each bar
 * keeps its latest attempt's profile, as the chart does.
 */
async function profiles(
  id: string,
  parameters: Readonly<Record<string, number | string>> = {},
  { bars = 48, forming = true, chart = market.resolution, live = 0 } = {},
) {
  const compiled = await compile(id);
  let newest = false;
  let realtime = false;
  const rows = <Row>(history: readonly Row[], attempts: readonly Row[] = []) =>
    from([...history, ...attempts]).pipe(
      map((row, index) => {
        newest = index >= history.length - 1;
        realtime = index >= history.length;
        return row;
      }),
    );
  const node = createNode(
    compiled.module.bind(
      parameters,
      marketContext(compiled.module.inputs, [market], chart),
    ),
    pineBuiltinSupplier(
      Date.now,
      () => realtime,
      () => newest,
    ),
  );
  const columns = node.module.inputs.schema.fields.map((field) => field.name);
  const closed = hourly(columns, bars, false);
  const input = live
    ? rows(
        hourly(columns, bars - live, true),
        closed
          .slice(bars - live - 1)
          .flatMap((row, i, attempts) =>
            i === 0
              ? [row]
              : [
                  { ...row, provisional: true },
                  ...(i < attempts.length - 1 ? [row] : []),
                ],
          ),
      )
    : rows(hourly(columns, bars, forming));
  const run = node.module.requests.reduce(
    (bound, request) =>
      bound.bind(
        new DataStream(
          columnSchema([]),
          rows(
            periods[request.context!.timeframe]!.map((time) => ({
              time,
              provisional: false,
            })),
          ),
        ),
        [request.name],
      ),
    node.bind(new DataStream(columnSchema(columns), input)),
  );
  const output = new Map<number, Datum>();
  try {
    await new Promise<void>((resolve, reject) =>
      run.to({
        next: (row) => output.set(row.index, row),
        error: reject,
        complete: resolve,
      }),
    );
  } finally {
    run.dispose();
    node.dispose();
  }
  return [...output.values()].map((row) => row.profile as Profile);
}

const volume = (profile: Profile) =>
  profile.rows
    .flatMap((row) => row.segments)
    .reduce((total, segment) => total + segment.value, 0);
// The rising and the falling bars' volume: each row's two segments.
const sides = (profile: Profile) =>
  profile.rows.reduce<[number, number]>(
    ([up, down], { segments: [rising, falling] }) => [
      up + rising!.value,
      down + falling!.value,
    ],
    [0, 0],
  );

it("reads the market's own bars, requesting only the session's period bars", async () => {
  expect(
    (await compile("session-volume-profile")).module.requests.map(
      ({ name }) => name,
    ),
  ).toEqual(["periodStart"]);
  expect((await compile("volume-profile-range")).module.requests).toHaveLength(
    0,
  );
});

it("writes each finished day on the next day's first bar and the forming day on the newest bar", async () => {
  const session = await profiles("session-volume-profile");
  // Only the rows the chart draws carry a profile.
  expect(session.flatMap((profile, index) => (profile ? [index] : []))).toEqual(
    [24, 47],
  );
  expect(session[24]).toMatchObject({ from: monday, to: monday + day });
  // sum(1000 + i) for i = 0..23: the even bars rose, the odd ones fell.
  expect(volume(session[24]!)).toBeCloseTo(24_276, 6);
  expect(sides(session[24]!)).toEqual([
    expect.closeTo(12_132, 6),
    expect.closeTo(12_144, 6),
  ]);
  expect(session[47]).toMatchObject({
    from: monday + day,
    to: monday + 48 * hour,
  });
  // sum(1000 + i) for i = 24..47
  expect(volume(session[47]!)).toBeCloseTo(24_852, 6);
  expect(sides(session[47]!)).toEqual([
    expect.closeTo(12_420, 6),
    expect.closeTo(12_432, 6),
  ]);
});

it("names each part, in one color for every row: no value area", async () => {
  for (const [id, parameters] of [
    ["session-volume-profile", {}],
    ["volume-profile-range", { rangeStart: monday + 40 * hour }],
  ] as const) {
    const profile = (await profiles(id, parameters)).at(-1)!;
    expect(
      new Set(
        profile.rows.flatMap(({ segments }) =>
          segments.map(({ title, color }) => JSON.stringify({ title, color })),
        ),
      ).size,
    ).toBe(2);
    expect(profile.rows[0]!.segments.map(({ title }) => title)).toEqual([
      "Up volume",
      "Down volume",
    ]);
    expect(profile.levels.map(({ title }) => title)).toEqual([
      "Point of control",
    ]);
  }
});

it("writes a past range once, on the first bar after it, over its bars only", async () => {
  const range = await profiles("volume-profile-range", {
    rangeStart: monday + 10 * hour,
    rangeEnd: monday + 20 * hour,
  });
  expect(range.flatMap((profile, index) => (profile ? [index] : []))).toEqual([
    20,
  ]);
  expect(range[20]).toMatchObject({
    from: monday + 10 * hour,
    to: monday + 20 * hour,
  });
  // sum(1000 + i) for i = 10..19
  expect(volume(range[20]!)).toBeCloseTo(10_145, 6);
  expect(sides(range[20]!)).toEqual([
    expect.closeTo(5_070, 6),
    expect.closeTo(5_075, 6),
  ]);
});

it("writes a range reaching the newest bar on that forming bar", async () => {
  const range = await profiles("volume-profile-range", {
    rangeStart: monday + 40 * hour,
  });
  expect(range.flatMap((profile, index) => (profile ? [index] : []))).toEqual([
    47,
  ]);
  // sum(1000 + i) for i = 40..47
  expect(volume(range[47]!)).toBeCloseTo(8_348, 6);
  expect(sides(range[47]!)).toEqual([
    expect.closeTo(4_172, 6),
    expect.closeTo(4_176, 6),
  ]);
});

it("writes the same profiles when the newest bar is already final, as between sessions", async () => {
  for (const [id, parameters] of [
    ["session-volume-profile", {}],
    ["volume-profile-range", { rangeStart: monday + 40 * hour }],
  ] as const)
    expect(await profiles(id, parameters, { forming: false })).toEqual(
      await profiles(id, parameters),
    );
});

it("writes a range once, on the last bar of a run that stops at its end", async () => {
  // A past range runs over its own window, so no bar follows it.
  const range = await profiles(
    "volume-profile-range",
    { rangeStart: monday + 10 * hour, rangeEnd: monday + 20 * hour },
    { bars: 20, forming: false },
  );
  expect(range.flatMap((profile, index) => (profile ? [index] : []))).toEqual([
    19,
  ]);
  // The profile the first bar after the range writes when there is one.
  expect(range[19]).toMatchObject({
    from: monday + 10 * hour,
    to: monday + 20 * hour,
  });
  expect(volume(range[19]!)).toBeCloseTo(10_145, 6);
  expect(sides(range[19]!)).toEqual([
    expect.closeTo(5_070, 6),
    expect.closeTo(5_075, 6),
  ]);
});

it("defaults its time range from the chart: days below 4h, weeks at 4h, months from 1d", async () => {
  const { module } = await compile("session-volume-profile");
  const range = (chart: BarsSeries["resolution"]) =>
    module
      .bind({}, marketContext(module.inputs, [market], chart))
      .parameters.find(({ name }) => name === "profileRange")!.value;
  expect((["1m", "1h", "4h", "1d", "1W", "1M"] as const).map(range)).toEqual([
    "Daily",
    "Daily",
    "Weekly",
    "Monthly",
    "Monthly",
    "Monthly",
  ]);
  // A chosen range overrides the chart's.
  const week = await profiles(
    "session-volume-profile",
    { profileRange: "Weekly" },
    { chart: "1h" },
  );
  expect(week.flatMap((profile, index) => (profile ? [index] : []))).toEqual([
    47,
  ]);
  expect(week[47]).toMatchObject({ from: monday, to: monday + 48 * hour });
});

it("counts hourly bars into months on a daily chart and into days on an hourly one", async () => {
  const month = await profiles("session-volume-profile", {}, { chart: "1d" });
  // Both days fall in January, so one profile runs through the newest bar.
  expect(month.flatMap((profile, index) => (profile ? [index] : []))).toEqual([
    47,
  ]);
  expect(month[47]).toMatchObject({ from: monday, to: monday + 48 * hour });
  // sum(1000 + i) for i = 0..47
  expect(volume(month[47]!)).toBeCloseTo(49_128, 6);
  const days = await profiles("session-volume-profile", {}, { chart: "1h" });
  expect(days.flatMap((profile, index) => (profile ? [index] : []))).toEqual([
    24, 47,
  ]);
});

it("keeps the running profile only on the newest bar of a live run", async () => {
  // Each closed live bar's row stays, so it carries no running profile.
  const session = await profiles(
    "session-volume-profile",
    {},
    { live: 8, chart: "1h" },
  );
  expect(session.flatMap((profile, index) => (profile ? [index] : []))).toEqual(
    [24, 47],
  );
  expect(session[47]).toMatchObject({
    from: monday + day,
    to: monday + 48 * hour,
  });
  expect(volume(session[47]!)).toBeCloseTo(24_852, 6);
  const range = await profiles(
    "volume-profile-range",
    { rangeStart: monday + 40 * hour },
    { live: 8 },
  );
  expect(range.flatMap((profile, index) => (profile ? [index] : []))).toEqual([
    47,
  ]);
  expect(volume(range[47]!)).toBeCloseTo(8_348, 6);
});
