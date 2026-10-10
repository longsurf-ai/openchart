// Purpose: Verify Yahoo count pagination, missing bars, overlapping polling, and cancellation.

import { Clock, Deferred, Effect, Stream } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { ProviderId } from "@openchart/market";
import { mergeByTime } from "@openchart/timeseries";
import { DatasetError } from "@openchart/server/data/dataset";
import { datasetFailure } from "@openchart/server/feed/errors";
import { yfinanceBars } from "@openchart/server/data/providers/yfinance/datasets/definitions";

import { request } from "./client";
import {
  cachedSelectBars,
  selectBars,
  streamBars,
} from "@openchart/server/data/providers/yfinance/datasets/bars";
import {
  cachedSearchSymbols,
  searchSymbols,
} from "@openchart/server/data/providers/yfinance/datasets/symbology";

function chart(
  times: number[],
  closes: (number | null)[],
  interval = "1d",
  firstTradeDate = 0,
  timezone = "Europe/London",
) {
  return {
    chart: {
      error: null,
      result: [
        {
          meta: {
            symbol: "VOD.L",
            currency: "GBp",
            exchangeName: "LSE",
            instrumentType: "EQUITY",
            firstTradeDate,
            dataGranularity: interval,
            exchangeTimezoneName: timezone,
          },
          timestamp: times.map((time) => time / 1000),
          indicators: {
            quote: [
              {
                open: closes,
                high: closes,
                low: closes,
                close: closes,
                volume: closes.map((close): number | null =>
                  close === null ? null : 100,
                ),
              },
            ],
          },
        },
      ],
    },
  };
}

describe("Yahoo Finance Provider", () => {
  it("reuses historical windows and counts without hiding intraday retention errors", async () => {
    const day = 86_400_000;
    const base = Date.UTC(2020, 0, 1);
    const times = Array.from({ length: 20 }, (_, i) => base + i * day);
    let calls = 0;
    const options = {
      fetch: (async (input) => {
        calls++;
        const url = new URL(String(input));
        const from = Number(url.searchParams.get("period1")) * 1000;
        const to = Number(url.searchParams.get("period2")) * 1000;
        const selected = times.filter((time) => time >= from && time < to);
        return Response.json(
          chart(
            selected,
            selected.map(() => 12),
            "1d",
            base / 1000,
            "UTC",
          ),
        );
      }) as typeof fetch,
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        const { select: cached } = yield* cachedSelectBars(options);
        const key = {
          symbol: "VOD.L",
          interval: "1d" as const,
          includePrePost: false,
        };
        const query = { ...key, time: { from: base, to: base + 10 * day } };
        const first = yield* cached(query);
        for (let i = 0; i < 10; i++)
          expect(yield* cached(query)).toEqual(first);
        expect(
          (yield* cached({ ...key, time: { to: base + 8 * day }, count: 4 }))
            .numRows,
        ).toBe(4);
        expect(calls).toBe(1);
        yield* cached({ ...query, includePrePost: true });
        expect(calls).toBe(2);
        const failure = yield* Effect.result(
          cached({ ...query, interval: "1m" }),
        );
        expect(failure).toMatchObject({
          _tag: "Failure",
          failure: { reason: { _tag: "Dataset.OutsideRetention" } },
        });
        expect(calls).toBe(2);
      }),
    );
  });

  it("retains boundary OHLCV and volume when an intraday window cuts through buckets", async () => {
    const minute = 60_000;
    const base = Math.floor(Date.now() / minute) * minute - 3_600_000;
    const times = Array.from(
      { length: 5 },
      (_, index) => base + index * minute,
    );
    const data = await Effect.runPromise(
      selectBars(
        {
          fetch: async (input) => {
            const url = new URL(String(input));
            const from = Number(url.searchParams.get("period1")) * 1000;
            const to = Number(url.searchParams.get("period2")) * 1000;
            const selected = times.filter((time) => time >= from && time < to);
            // Observed Yahoo behavior: a cut-off final bucket has null OHLCV;
            // a first bucket touched by period1 can have zero volume.
            const body = chart(
              selected,
              selected.map((time) => (time + minute > to ? null : 12)),
              "1m",
            );
            body.chart.result[0]!.indicators.quote[0]!.volume = selected.map(
              (time) =>
                time + minute > to ? null : time < from + minute ? 0 : 100,
            );
            return Response.json(body);
          },
        },
        {
          symbol: "VOD.L",
          interval: "1m",
          includePrePost: false,
          time: { from: base + 30_000, to: base + 150_000 },
        },
      ),
    );
    expect(
      [...data].map(({ time, close, volume }) => ({ time, close, volume })),
    ).toEqual([
      { time: base + minute, close: 12, volume: 100 },
      { time: base + 2 * minute, close: 12, volume: 100 },
    ]);
  });

  it("keeps padded one-minute pages within seven days without losing or repeating boundary bars", async () => {
    const day = 86_400_000;
    const minute = 60_000;
    const base = Math.floor(Date.now() / minute) * minute - 10 * day;
    const times = Array.from(
      { length: 8 * 24 * 60 + 2 },
      (_, index) => base + index * minute,
    );
    const from = base + 30_500;
    const to = base + 8 * day + 30_500;
    let calls = 0;
    const data = await Effect.runPromise(
      selectBars(
        {
          fetch: async (input) => {
            calls++;
            const url = new URL(String(input));
            const sourceFrom = Number(url.searchParams.get("period1")) * 1000;
            const sourceTo = Number(url.searchParams.get("period2")) * 1000;
            expect(sourceTo - sourceFrom).toBeLessThanOrEqual(7 * day);
            const selected = times.filter(
              (time) => time >= sourceFrom && time < sourceTo,
            );
            return Response.json(
              chart(
                selected,
                selected.map(() => 12),
                "1m",
              ),
            );
          },
        },
        {
          symbol: "VOD.L",
          interval: "1m",
          includePrePost: false,
          time: { from, to },
        },
      ),
    );
    expect(calls).toBe(2);
    expect([...data].map(({ time }) => time)).toEqual(
      times.filter((time) => time >= from && time < to),
    );
  });

  it("replaces daily history with single-row polls and only appends on a new date", async () => {
    // Captured AAPL history/open and two Monday poll timestamps: the polls
    // contain only today's cumulative OHLCV, stamped with the latest quote.
    const times = [1789997400000, 1789999466000, 1789999584000, 1790083800000];
    const clock = Effect.runSync(Clock.Clock);
    let observedAt = Date.UTC(2026, 8, 23);
    const frames = [];
    for (const [index, time] of times.entries()) {
      observedAt += 15_000;
      const data = await Effect.runPromise(
        selectBars(
          {
            fetch: async () =>
              Response.json(
                chart([time], [335 + index], "1d", 0, "America/New_York"),
              ),
          },
          {
            symbol: "VOD.L",
            interval: "1d",
            includePrePost: false,
            time: { from: Date.UTC(2026, 8, 18), to: observedAt },
          },
        ).pipe(
          Effect.provideService(Clock.Clock, {
            ...clock,
            currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
            monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
            currentTimeMillisUnsafe: () => observedAt,
            sleep: (duration) => clock.sleep(duration),
            currentTimeMillis: Effect.sync(() => observedAt),
          }),
        ),
      );
      expect(data.get(0)?.asOf).toBe(observedAt);
      frames.push(data);
    }
    const current = mergeByTime(
      mergeByTime(frames[0]!, frames[1]!),
      frames[2]!,
    );
    expect([...current]).toEqual([
      {
        time: Date.UTC(2026, 8, 21, 4),
        open: 337,
        high: 337,
        low: 337,
        close: 337,
        volume: 100,
        asOf: Date.UTC(2026, 8, 23) + 45_000,
      },
    ]);
    expect(
      [...mergeByTime(current, frames[3]!)].map(({ time }) => time),
    ).toEqual([Date.UTC(2026, 8, 21, 4), Date.UTC(2026, 8, 22, 4)]);
  });

  it.each([
    ["America/New_York", "2026-03-06T14:30Z", "2026-03-06T05:00Z"],
    ["America/New_York", "2026-03-09T13:30Z", "2026-03-09T04:00Z"],
    ["Asia/Hong_Kong", "2026-03-09T01:30Z", "2026-03-08T16:00Z"],
  ])(
    "uses the local date in %s for %s, replacing same-response duplicates",
    async (timezone, open, midnight) => {
      const time = Date.parse(open);
      const data = await Effect.runPromise(
        selectBars(
          {
            fetch: async () =>
              Response.json(
                chart([time, time + 60_000], [12, 13], "1d", 0, timezone),
              ),
          },
          {
            symbol: "VOD.L",
            interval: "1d",
            includePrePost: false,
            time: { from: time - 86_400_000, to: time + 120_000 },
          },
        ),
      );
      expect(
        [...data].map(({ time, close, volume }) => ({ time, close, volume })),
      ).toEqual([{ time: Date.parse(midnight), close: 13, volume: 100 }]);
    },
  );

  it("filters daily ranges by bar date and retains the first trading date during count pagination", async () => {
    const day = 86_400_000;
    const firstDate = Date.UTC(2026, 0, 5);
    const rows = [firstDate + 8 * 3_600_000, firstDate + day + 8 * 3_600_000];
    const options = {
      fetch: async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const from = Number(url.searchParams.get("period1")) * 1000;
        const to = Number(url.searchParams.get("period2")) * 1000;
        const times = rows.filter((time) => time >= from && time < to);
        return Response.json(
          chart(
            times,
            times.map(() => 12),
            "1d",
            rows[0]! / 1000,
          ),
        );
      },
    };
    const query = {
      symbol: "VOD.L",
      interval: "1d" as const,
      includePrePost: false,
    };
    const withinDay = await Effect.runPromise(
      selectBars(options, {
        ...query,
        time: { from: firstDate, to: firstDate + 1 },
      }),
    );
    expect([...withinDay].map(({ time }) => time)).toEqual([firstDate]);
    const exclusiveEnd = await Effect.runPromise(
      selectBars(options, {
        ...query,
        time: { from: firstDate, to: firstDate + day },
      }),
    );
    expect([...exclusiveEnd].map(({ time }) => time)).toEqual([firstDate]);
    const afterFirstDate = await Effect.runPromise(
      selectBars(options, {
        ...query,
        time: { from: firstDate + 1, to: firstDate + 2 * day },
      }),
    );
    expect([...afterFirstDate].map(({ time }) => time)).toEqual([
      firstDate + day,
    ]);
    const counted = await Effect.runPromise(
      selectBars(options, {
        ...query,
        time: { to: firstDate + 14 * day },
        count: 2,
      }),
    );
    expect([...counted].map(({ time }) => time)).toEqual([
      firstDate,
      firstDate + day,
    ]);
  });

  it.each([undefined, "invalid/timezone"])(
    "rejects unresolvable daily dates with timezone %s",
    async (timezone) => {
      const body = chart([Date.UTC(2026, 0, 5, 8)], [12]);
      Object.assign(body.chart.result[0]!.meta, {
        exchangeTimezoneName: timezone,
      });
      const error = await Effect.runPromise(
        Effect.flip(
          selectBars(
            {
              fetch: async () => Response.json(body),
            },
            {
              symbol: "VOD.L",
              interval: "1d",
              includePrePost: false,
              time: { from: Date.UTC(2026, 0, 5), to: Date.UTC(2026, 0, 6) },
            },
          ),
        ),
      );
      expect(error.reason._tag).toBe("Dataset.InvalidResult");
    },
  );

  it("distinguishes source throttling from denied public access", async () => {
    for (const status of [401, 403, 429]) {
      const error = await Effect.runPromise(
        Effect.flip(
          request(
            {
              fetch: async () => new Response(null, { status }),
            },
            "/v1/finance/search",
            { q: "VOD.L" },
          ),
        ),
      );
      expect(error.reason._tag).toBe(
        status === 429 ? "Dataset.RateLimited" : "Dataset.AccessDenied",
      );
    }
  });

  it("merges Yahoo separate current-day OHLCV into its weekly bucket", async () => {
    const monday = Date.UTC(2026, 8, 6, 23);
    const friday = Date.UTC(2026, 8, 11, 8);
    const data = await Effect.runPromise(
      selectBars(
        {
          fetch: async () =>
            Response.json(chart([monday, friday], [12, 13], "1wk")),
        },
        {
          symbol: "VOD.L",
          interval: "1wk",
          includePrePost: false,
          time: { from: monday, to: friday + 1000 },
        },
      ),
    );
    expect([...data].map((row) => row.time)).toEqual([monday]);
    expect([...data].map((row) => row.open)).toEqual([12]);
    expect([...data].map((row) => row.close)).toEqual([13]);
    expect([...data].map((row) => row.volume)).toEqual([200]);
  });

  it("asks for weeks from a Monday, so Yahoo's weekly bars start on Mondays", async () => {
    const starts: string[] = [];
    await Effect.runPromise(
      selectBars(
        {
          fetch: (async (input) => {
            const url = new URL(String(input));
            starts.push(
              new Date(
                Number(url.searchParams.get("period1")) * 1000,
              ).toISOString(),
            );
            return Response.json(chart([], [], "1wk"));
          }) as typeof fetch,
        },
        {
          symbol: "VOD.L",
          interval: "1wk",
          includePrePost: false,
          // A Friday, which Yahoo would otherwise start each week on.
          time: { from: Date.UTC(2021, 0, 1), to: Date.UTC(2021, 1, 1) },
        },
      ),
    );
    expect(starts).toEqual(["2020-12-28T00:00:00.000Z"]);
  });

  it("omits Yahoo appended last-price quotes inside an intraday bucket", async () => {
    const time = Math.floor(Date.now() / 60_000) * 60_000 - 120_000;
    const data = await Effect.runPromise(
      selectBars(
        {
          fetch: async () =>
            Response.json(
              chart([time, time + 60_000, time + 89_000], [12, null, 13], "1m"),
            ),
        },
        {
          symbol: "VOD.L",
          interval: "1m",
          includePrePost: false,
          time: { from: time, to: time + 100_000 },
        },
      ),
    );
    expect([...data].map((row) => row.time)).toEqual([time]);
    expect([...data].map((row) => row.close)).toEqual([12]);
  });

  it("continues across empty windows to obtain actual count and omits missing OHLCV", async () => {
    const day = 86_400_000;
    const calls: number[] = [];
    const rows = [day, 5 * day, 10 * day];
    const data = await Effect.runPromise(
      selectBars(
        {
          fetch: async (input) => {
            const url = new URL(String(input));
            const from = Number(url.searchParams.get("period1")) * 1000;
            const to = Number(url.searchParams.get("period2")) * 1000;
            calls.push(from);
            const times = rows.filter((time) => time >= from && time < to);
            return Response.json(
              chart(
                times,
                times.map((time) => (time === 5 * day ? null : 12)),
                "1d",
                day / 1000,
                "UTC",
              ),
            );
          },
        },
        {
          symbol: "VOD.L",
          interval: "1d",
          includePrePost: false,
          time: { to: 16 * day },
          count: 2,
        },
      ),
    );
    expect(calls).toHaveLength(3);
    expect([...data].map((row) => row.time)).toEqual([day, 10 * day]);
    expect([...data].map((row) => row.volume)).toEqual([100, 100]);
  });

  it.each(["open", "high", "low", "close", "volume"] as const)(
    "fails incomplete %s in both history and polling instead of returning an older price",
    async (column) => {
      const day = 86_400_000;
      const today = Math.floor(Date.now() / day) * day;
      const body = chart(
        [today - day, today],
        [254.06, 262.43],
        "1d",
        0,
        "UTC",
      );
      const quote = body.chart.result[0]!.indicators.quote[0]!;
      quote[column] = [...quote[column]];
      quote[column][1] = null;
      const options = { fetch: async () => Response.json(body) };
      const key = {
        symbol: "VOD.L",
        interval: "1d" as const,
        includePrePost: false,
      };
      await expect(
        Effect.runPromise(
          selectBars(options, { ...key, time: { from: today - day } }),
        ),
      ).rejects.toMatchObject({ reason: { _tag: "Dataset.IncompleteData" } });
      await expect(
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const updates = yield* streamBars(
                options,
                key,
                yield* Deferred.make<void>(),
              );
              return yield* Stream.runCollect(Stream.take(updates, 1));
            }),
          ),
        ),
      ).rejects.toMatchObject({ reason: { _tag: "Dataset.IncompleteData" } });
    },
  );

  it("does not cache incomplete history and accepts a repaired response", async () => {
    const from = Date.UTC(2025, 0, 6);
    const body = chart([from], [12], "1d", 0, "UTC");
    const quote = body.chart.result[0]!.indicators.quote[0]!;
    quote.close = [null];
    let calls = 0;
    const options = {
      fetch: async () => {
        calls++;
        return Response.json(body);
      },
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        const { select } = yield* cachedSelectBars(options);
        const query = {
          symbol: "VOD.L",
          interval: "1d" as const,
          includePrePost: false,
          time: { from, to: from + 86_400_000 },
        };
        const failure = yield* Effect.flip(select(query));
        expect(failure.reason._tag).toBe("Dataset.IncompleteData");
        quote.close[0] = 12;
        expect((yield* select(query)).get(0)?.close).toBe(12);
        yield* select(query);
        expect(calls).toBe(2);
      }),
    );
  });

  it("keeps empty price slots as gaps, preserves zero-volume bars and ignores incomplete rows outside the window", async () => {
    const day = 86_400_000;
    const from = Date.UTC(2025, 0, 6);
    const body = chart(
      [from, from + day, from + 2 * day],
      [null, 12, 13],
      "1d",
      0,
      "UTC",
    );
    const quote = body.chart.result[0]!.indicators.quote[0]!;
    quote.volume[0] = 0;
    quote.volume[1] = 0;
    quote.close = [null, 12, null];
    const data = await Effect.runPromise(
      selectBars(
        { fetch: async () => Response.json(body) },
        {
          symbol: "VOD.L",
          interval: "1d",
          includePrePost: false,
          time: { from, to: from + 2 * day },
        },
      ),
    );
    expect([...data]).toMatchObject([
      { time: from + day, close: 12, volume: 0 },
    ]);
  });

  it.each([{ from: 1000, to: 2000 }, { to: 2000 }])(
    "returns empty history for Yahoo's explicit missing range: %j",
    async (time) => {
      const data = await Effect.runPromise(
        selectBars(
          {
            fetch: async () =>
              Response.json(
                {
                  chart: {
                    result: null,
                    error: {
                      code: "Bad Request",
                      description:
                        "Data doesn't exist for startDate = 1, endDate = 2",
                    },
                  },
                },
                { status: 400 },
              ),
          },
          {
            symbol: "VOD.L",
            interval: "1wk",
            includePrePost: false,
            time,
            count: 2,
          },
        ),
      );
      expect(data.numRows).toBe(0);
    },
  );

  it("preserves fetched bars and continues past a missing range to satisfy count", async () => {
    const week = 7 * 86_400_000;
    const data = await Effect.runPromise(
      selectBars(
        {
          fetch: async (input) => {
            const url = new URL(String(input));
            const from = Number(url.searchParams.get("period1")) * 1000;
            const to = Number(url.searchParams.get("period2")) * 1000;
            const times = [week, 10 * week].filter(
              (time) => time >= from && time < to,
            );
            return times.length
              ? Response.json(
                  chart(
                    times,
                    times.map(() => 12),
                    "1wk",
                    1,
                    "UTC",
                  ),
                )
              : Response.json(
                  {
                    chart: {
                      result: null,
                      error: {
                        code: "Bad Request",
                        description: `Data doesn't exist for startDate = ${from / 1000}, endDate = ${to / 1000}`,
                      },
                    },
                  },
                  { status: 400 },
                );
          },
        },
        {
          symbol: "VOD.L",
          interval: "1wk",
          includePrePost: false,
          time: { to: 16 * week },
          count: 2,
        },
      ),
    );
    expect([...data].map(({ time }) => time)).toEqual([week, 10 * week]);
  });

  it.each([
    [
      400,
      "Bad Request",
      "Invalid input - start date cannot be after end date",
      "Dataset.InvalidQuery",
    ],
    [
      400,
      "Not Found",
      "Data doesn't exist for startDate = 1, endDate = 2",
      "Dataset.InvalidQuery",
    ],
    [
      404,
      "Not Found",
      "No data found, symbol may be delisted",
      "Dataset.NotFound",
    ],
    [
      429,
      "Bad Request",
      "Data doesn't exist for startDate = 1, endDate = 2",
      "Dataset.RateLimited",
    ],
  ])(
    "preserves other Yahoo errors (%s, %s)",
    async (status, code, description, expected) => {
      const error = await Effect.runPromise(
        Effect.flip(
          selectBars(
            {
              fetch: async () =>
                Response.json(
                  { chart: { result: null, error: { code, description } } },
                  { status },
                ),
            },
            {
              symbol: "VOD.L",
              interval: "1wk",
              includePrePost: false,
              time: { from: 1000, to: 2000 },
            },
          ),
        ),
      );
      expect(error.reason._tag).toBe(expected);
    },
  );

  it("reports the next whole day after the retention start and Feed keeps it as availableFrom", async () => {
    const now = Date.UTC(2026, 9, 1, 15, 30);
    const retentionStart = now - 30 * 86_400_000;
    const availableFrom = Date.UTC(2026, 8, 2);
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(now);
        return yield* Effect.flip(
          selectBars(
            { fetch: () => Promise.reject(new Error("unexpected request")) },
            {
              symbol: "VOD.L",
              interval: "1m",
              includePrePost: false,
              time: { from: retentionStart - 1 },
            },
          ),
        );
      }).pipe(Effect.provide(TestClock.layer())),
    );
    expect(failure.reason).toMatchObject({
      _tag: "Dataset.OutsideRetention",
      availableFrom,
    });
    const error = datasetFailure(ProviderId.make("yfinance"))(
      new DatasetError({
        dataset: yfinanceBars.name,
        operation: "select",
        reason: failure.reason,
      }),
    );
    expect(error.reason).toMatchObject({
      _tag: "Feed.HistoryUnavailable",
      provider: "yfinance",
      availableFrom,
    });
  });

  it("does not silently accept malformed column lengths or an error envelope", async () => {
    const body = chart([1000, 2000], [12]);
    const query = {
      symbol: "VOD.L",
      interval: "1d" as const,
      includePrePost: false,
      time: { from: 0, to: 3000 },
    };
    const malformed = await Effect.runPromise(
      Effect.flip(
        selectBars({ fetch: async () => Response.json(body) }, query),
      ),
    );
    expect(malformed.reason._tag).toBe("Dataset.InvalidResult");
    const missing = await Effect.runPromise(
      Effect.flip(
        selectBars(
          {
            fetch: async () =>
              Response.json({
                chart: {
                  result: null,
                  error: { code: "Not Found", description: "No data" },
                },
              }),
          },
          query,
        ),
      ),
    );
    expect(missing.reason._tag).toBe("Dataset.NotFound");
  });

  it("starts polling after acquisition and preserves corrections in overlapping windows", async () => {
    let calls = 0;
    const requests: URL[] = [];
    const time = Math.floor(Date.now() / 60_000) * 60_000 - 60_000;
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* streamBars(
            {
              pollIntervalMs: 1,
              fetch: async (input) => {
                requests.push(new URL(String(input)));
                calls++;
                return Response.json(chart([time], [calls], "1m"));
              },
            },
            { symbol: "VOD.L", interval: "1m", includePrePost: false },
            yield* Deferred.make<void>(),
          );
          expect(calls).toBe(0);
          return yield* Stream.runCollect(Stream.take(updates, 2));
        }),
      ),
    );
    expect(result.map((data) => data.get(0)?.close)).toEqual([1, 2]);
    expect(
      requests.every(
        (url) => Number(url.searchParams.get("period1")) * 1000 <= time,
      ),
    ).toBe(true);
  });

  it("enriches source search results with source currency", async () => {
    const data = await Effect.runPromise(
      searchSymbols(
        {
          fetch: async (input) => {
            const url = new URL(String(input));
            if (url.pathname.includes("/search"))
              return Response.json({
                quotes: [
                  {
                    isYahooFinance: true,
                    symbol: "VOD.L",
                    shortname: "Vodafone",
                    exchange: "LSE",
                    quoteType: "EQUITY",
                  },
                ],
              });
            return Response.json(chart([1000], [12]));
          },
        },
        { query: "VOD.L", limit: 1 },
      ),
    );
    expect(data).toEqual([
      {
        symbol: "VOD.L",
        shortname: "Vodafone",
        exchange: "LSE",
        quoteType: "EQUITY",
        currency: "GBp",
      },
    ]);
  });

  it("leaves out a search result whose chart has no currency", async () => {
    const pair = chart([1000], [12]);
    Object.assign(pair.chart.result[0]!.meta, {
      symbol: "XAGAMD=X",
      currency: null,
    });
    const data = await Effect.runPromise(
      searchSymbols(
        {
          fetch: async (input) => {
            const url = new URL(String(input));
            if (url.pathname.includes("/search"))
              return Response.json({
                quotes: ["VOD.L", "XAGAMD=X"].map((symbol) => ({
                  isYahooFinance: true,
                  symbol,
                  exchange: "LSE",
                  quoteType: "EQUITY",
                })),
              });
            return Response.json(
              url.pathname.includes("XAGAMD") ? pair : chart([1000], [12]),
            );
          },
        },
        { query: "AMD", limit: 10 },
      ),
    );
    expect(data.map(({ symbol }) => symbol)).toEqual(["VOD.L"]);
  });

  it("reads each symbol's chart once across searches", async () => {
    const charts: string[] = [];
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const { search } = yield* cachedSearchSymbols({
          fetch: async (input) => {
            const url = new URL(String(input));
            if (url.pathname.includes("/search"))
              return Response.json({
                quotes: [
                  {
                    isYahooFinance: true,
                    symbol: "VOD.L",
                    exchange: "LSE",
                    quoteType: "EQUITY",
                  },
                ],
              });
            charts.push(url.pathname);
            return Response.json(chart([1000], [12]));
          },
        });
        yield* search({ query: "VOD.L", limit: 10 });
        return yield* search({ query: "Vodafone", limit: 10 });
      }),
    );
    expect(rows.map(({ symbol }) => symbol)).toEqual(["VOD.L"]);
    expect(charts).toEqual(["/v8/finance/chart/VOD.L"]);
  });

  it("reads an exact ticker from its chart when the search finds no quotes", async () => {
    const search = (query: string) =>
      Effect.runPromise(
        searchSymbols(
          {
            fetch: async (input) => {
              const url = new URL(String(input));
              if (url.pathname.includes("/search"))
                return Response.json({ quotes: [] });
              if (url.pathname.endsWith("/VOD.L")) {
                const vodafone = chart([1000], [12]);
                Object.assign(vodafone.chart.result[0]!.meta, {
                  longName: "Vodafone Group Public Limited Company",
                  shortName: "VODAFONE GROUP PLC",
                });
                return Response.json(vodafone);
              }
              return new Response(null, { status: 404 });
            },
          },
          { query, limit: 10 },
        ),
      );
    expect(await search("vod.l")).toEqual([
      {
        symbol: "VOD.L",
        shortname: "VODAFONE GROUP PLC",
        longname: "Vodafone Group Public Limited Company",
        exchange: "LSE",
        quoteType: "EQUITY",
        currency: "GBp",
      },
    ]);
    expect(await search("no such company")).toEqual([]);
  });

  it("cancels an active poll through the fetch signal", async () => {
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    let aborted = false;
    const controller = new AbortController();
    const work = Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* streamBars(
          {
            fetch: (_input, options) =>
              new Promise((_resolve, reject) => {
                options!.signal!.addEventListener("abort", () => {
                  aborted = true;
                  reject(options!.signal!.reason);
                });
                started();
              }),
          },
          { symbol: "VOD.L", interval: "1m", includePrePost: false },
          yield* Deferred.make<void>(),
        );
        return yield* Stream.runDrain(updates);
      }),
    );
    const result = Effect.runPromise(work, { signal: controller.signal });
    const rejected = expect(result).rejects.toThrow();
    await waiting;
    controller.abort();
    await rejected;
    expect(aborted).toBe(true);
  });

  it("retirement lets the current poll finish but never starts another", async () => {
    const retired = Effect.runSync(Deferred.make<void>());
    const started = Effect.runSync(Deferred.make<void>());
    let finish!: (response: Response) => void;
    let calls = 0;
    let signal: AbortSignal | undefined | null;
    const time = Math.floor(Date.now() / 60_000) * 60_000 - 60_000;
    const pending = Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* streamBars(
            {
              pollIntervalMs: 60_000,
              fetch: (_input, options) => {
                calls++;
                signal = options?.signal;
                return new Promise<Response>((resolve) => {
                  finish = resolve;
                  Effect.runSync(Deferred.succeed(started, undefined));
                });
              },
            },
            { symbol: "VOD.L", interval: "1m", includePrePost: false },
            retired,
          );
          return yield* Stream.runCollect(updates);
        }),
      ),
    );
    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(Deferred.succeed(retired, undefined));
    expect(signal?.aborted).toBe(false);
    finish(Response.json(chart([time], [12], "1m")));
    expect((await pending).map((data) => data.get(0)?.close)).toEqual([12]);
    expect(calls).toBe(1);
    const late = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* streamBars(
            {
              fetch: async () => {
                throw new Error("late poll");
              },
            },
            { symbol: "VOD.L", interval: "1m", includePrePost: false },
            retired,
          );
          return yield* Stream.runCollect(updates);
        }),
      ),
    );
    expect(late).toEqual([]);
  });
});
