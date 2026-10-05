// Purpose: Opt-in production validation across representative listings through the real App Feed and Tea engine.
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { ConfigProvider, Effect, Schema, Stream } from "effect";
import { expect, test, vi } from "vitest";
import { makeRuntime } from "@openchart/server/runtime";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { jweEncryption } from "@openchart/server/access/credential/encryption";
import { OPENCHART_CLOUD } from "@openchart/server/access/integration/openchart-cloud";
import { router } from "@openchart/server";
import { Feed } from "@openchart/server/feed/service";
import { BarsRequest, BarsSeries } from "@openchart/feed";
import * as Tea from "@openchart/server/tea/tea";
import {
  OpenChartResolution,
  OpenChartAdjustment,
} from "@openchart/server/data/providers/openchart/contract";

// An RSI request over one listing's Bars, as the Tea service takes it.
const teaRequest = ({
  inputs,
  ...request
}: Omit<Tea.ObserveRequest, keyof Tea.NodeConfig | "nodes" | "warmupBars"> &
  Pick<Tea.NodeConfig, "parameters" | "requests"> & {
    readonly inputs: unknown;
  }): Tea.ObserveRequest => ({
  ...request,
  ...Tea.barsInputs(Schema.decodeUnknownSync(BarsSeries)(inputs)),
  nodes: {},
  warmupBars: Tea.standardWarmupBars,
});

const cases = [
  ["AAPL", "1W", "split", "2020 split and weekly RSI"],
  ["MSFT", "1M", "split_dividend", "monthly total return"],
  ["NVDA", "1d", "split", "multiple splits and daily live"],
  ["NVDA", "1d", "split_dividend", "total return daily live"],
  ["AAPL", "1d", "split", "split-adjusted daily live"],
  ["NVDA", "1m", "split", "split-adjusted minute live"],
  ["NVDA", "1d", "raw", "daily history and live admission"],
  ["NVDA", "1m", "raw", "minute history and live admission"],
  ["NVDA", "1W", "split", "split-adjusted weekly history and live"],
  ["NVDA", "1M", "split_dividend", "total-return monthly history and live"],
  ["CBRS", "1d", "raw", "new listing with short daily history"],
  ["CBRS", "1W", "split", "partial IPO week and adjusted live admission"],
  ["TSLA", "1W", "split", "multiple splits and expanded history"],
  ["AMZN", "1M", "split", "monthly split adjustment"],
  ["GOOGL", "1W", "split_dividend", "share class and adjusted week"],
  ["META", "1d", "raw", "long raw daily history"],
  ["BRK.B", "1W", "raw", "punctuated ticker"],
  ["JPM", "1M", "split_dividend", "dividend-paying financial"],
  ["XOM", "1d", "raw", "energy listing identity"],
  ["COIN", "5m", "raw", "intraday session gaps"],
  ["PLTR", "15m", "raw", "intraday expanded history"],
  ["SPY", "1W", "split_dividend", "ETF adjusted weekly"],
  ["QQQ", "30m", "raw", "ETF intraday"],
  ["IWM", "1h", "raw", "small-cap ETF hourly"],
  ["TLT", "1M", "split_dividend", "bond ETF monthly distributions"],
  ["GLD", "1d", "raw", "commodity trust identity"],
  ["BTC/USD", "1s", "split_dividend", "provider second bars"],
  ["ETH/USD", "1m", "split", "minute live revisions"],
  ["SOL/USD", "5m", "raw", "five-minute live revisions"],
  ["DOGE/USD", "15m", "raw", "small-price precision"],
  ["XRP/USD", "30m", "raw", "half-hour live revisions"],
  ["ADA/USD", "4h", "raw", "four-hour aggregation"],
  ["LTC/USD", "1W", "split", "crypto weekly derived bar"],
  ["AVAX/USD", "1M", "split_dividend", "crypto monthly derived bar"],
  ...OpenChartResolution.literals.flatMap((resolution) =>
    OpenChartAdjustment.literals.map(
      (adjustment) =>
        [
          "BTC/USD",
          resolution,
          adjustment,
          "all-period adjusted live and RSI",
        ] as const,
    ),
  ),
] as const;

const credentialFile = process.env.OPENCHART_PROVIDER_SMOKE_CREDENTIAL_FILE;
test.skipIf(!credentialFile || !process.env.OPENCHART_PROVIDER_MATRIX)(
  "production listing matrix: identity, history expansion, OHLCV, RSI and live",
  async () => {
    const saved = JSON.parse(await readFile(credentialFile!, "utf8")) as {
      key: string;
      keyId: string;
      user: string;
    };
    const runtime = makeRuntime({
      home: temporaryHome(),
      databasePath: ":memory:",
      credentialEncryption: jweEncryption(randomBytes(32)),
      auth: { integrationID: OPENCHART_CLOUD.integrationID },
      integrations: { methods: [OPENCHART_CLOUD] },
      config: ConfigProvider.fromUnknown({
        providers: {
          binance: { enabled: false },
          yfinance: { enabled: false },
        },
      }),
      models: { fetchEnabled: false, userAgent: "openchart-provider-matrix" },
    });
    try {
      await router.createCaller({ runtime }).access.auth.completeSignIn({
        apiKeyID: saved.keyId,
        key: saved.key,
        user: {
          id: saved.user,
          email: "weilun@longsurf.ai",
          firstName: "Weilun",
          lastName: "Chen",
        },
      });
      const feed = await runtime.runPromise(Feed);
      await vi.waitFor(
        async () => {
          const services = await runtime.runPromise(feed.get());
          const state = await runtime.runPromise(
            services.symbology.indexStatus(),
          );
          expect(
            state.find((v) => v.providerId === "openchart")?.available,
          ).toBe(true);
        },
        { timeout: 15000 },
      );
      const services = await runtime.runPromise(feed.get());
      const tea = await runtime.runPromise(Tea.Service);
      const rsi = await runtime.runPromise(
        tea.compile({
          entry: "<inline>",
          sources: { "<inline>": 'plot("rsi", ta.rsi(close, 14))' },
        }),
      );
      const results = [];
      try {
        for (const [symbol, resolution, adjustment, scenario] of cases) {
          const started = Date.now();
          try {
            const hits = await runtime.runPromise(
              services.symbology.search({
                query: symbol,
                limit: 200,
                indexed: false,
              }),
            );
            const hit = hits.find(
              (h) => h.provider === "openchart" && h.listing.symbol === symbol,
            );
            expect(hit, `${symbol} identity`).toBeDefined();
            const lookback =
              resolution === "1s"
                ? 300000
                : ["1m", "5m", "15m", "30m", "1h", "4h"].includes(resolution)
                  ? 86400000 * 7
                  : 86400000 * 365 * 6;
            const inputs = {
              ...hit!,
              resolution,
              session: "regular",
              adjustment,
            };
            const result = await runtime.runPromise(
              Effect.scoped(
                Effect.gen(function* () {
                  const recent = yield* services.bars.observe(
                    Schema.decodeUnknownSync(BarsRequest)({
                      ...inputs,
                      from: started - lookback,
                      to: started,
                      countBack: 50,
                    }),
                  );
                  const expanded = yield* services.bars.observe(
                    Schema.decodeUnknownSync(BarsRequest)({
                      ...inputs,
                      from: started - lookback * 2,
                      to: started,
                      countBack: 50,
                    }),
                  );
                  expect(recent.snapshot.data.numRows).toBeGreaterThan(0);
                  expect(expanded.snapshot.data.numRows).toBeGreaterThanOrEqual(
                    recent.snapshot.data.numRows,
                  );
                  let previous = -Infinity;
                  for (const bar of expanded.snapshot.data) {
                    expect(bar.time).toBeGreaterThan(previous);
                    expect(bar).toMatchObject({ final: true });
                    for (const value of [
                      bar.open,
                      bar.high,
                      bar.low,
                      bar.close,
                      bar.volume,
                    ])
                      expect(value).toBeTypeOf("number");
                    expect(bar.low).toBeLessThanOrEqual(
                      Math.min(bar.open!, bar.close!),
                    );
                    expect(bar.high).toBeGreaterThanOrEqual(
                      Math.max(bar.open!, bar.close!),
                    );
                    expect(bar.volume).toBeGreaterThanOrEqual(0);
                    previous = bar.time;
                  }
                  const capabilities = yield* services.bars.getCapabilities(
                    hit!,
                  );
                  const live = capabilities.some(
                    (c) =>
                      c.resolution === resolution &&
                      c.adjustment === adjustment &&
                      c.session === "regular" &&
                      c.modes.includes("live"),
                  );
                  expect(live).toBe(true);
                  const observed = yield* tea.observe(
                    teaRequest({
                      id: rsi.id,
                      parameters: {},
                      inputs,
                      requests: {},
                      from: started - lookback,
                      to: "now",
                      countBack: 50,
                    }),
                  );
                  expect(observed.snapshot.data.numRows).toBeGreaterThan(0);
                  let liveFrames = 0;
                  if (hit!.listing.class === "crypto") {
                    const frames = yield* observed.updates!.pipe(
                      Stream.take(2),
                      Stream.runCollect,
                      Effect.timeout("45 seconds"),
                    );
                    liveFrames = frames.length;
                    expect(liveFrames).toBe(2);
                  } else {
                    // Closed equity sessions may legitimately have no new price. Consume
                    // the stream briefly so initialization/finality failures still surface.
                    yield* observed.updates!.pipe(
                      Stream.tap(() =>
                        Effect.sync(() => {
                          liveFrames++;
                        }),
                      ),
                      Stream.interruptWhen(Effect.sleep("2 seconds")),
                      Stream.runDrain,
                    );
                  }
                  return {
                    listing: hit!.listing.id,
                    historyRows: recent.snapshot.data.numRows,
                    expandedRows: expanded.snapshot.data.numRows,
                    rsiRows: observed.snapshot.data.numRows,
                    liveFrames,
                    liveSupported: live,
                  };
                }),
              ),
            );
            results.push({
              symbol,
              resolution,
              adjustment,
              scenario,
              status: "passed",
              ...result,
              elapsedMs: Date.now() - started,
            });
          } catch (error) {
            results.push({
              symbol,
              resolution,
              adjustment,
              scenario,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
              elapsedMs: Date.now() - started,
            });
          }
          console.log("OpenChart listing matrix", results.at(-1));
        }
      } finally {
        await runtime.runPromise(tea.dispose({ id: rsi.id }));
      }
      if (process.env.OPENCHART_PROVIDER_MATRIX_REPORT)
        await writeFile(
          process.env.OPENCHART_PROVIDER_MATRIX_REPORT,
          JSON.stringify(results, null, 2),
        );
      expect(results.filter((r) => r.status === "failed")).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  },
  600000,
);
