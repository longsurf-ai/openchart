// Purpose: Opt-in production smoke through the App's real Provider, Feed and Tea bindings.
import { readFile } from "node:fs/promises";
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
import { TeaAlerts } from "@openchart/server/alert/tea-alerts";
import * as Tea from "@openchart/server/tea/tea";

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

const credentialFile = process.env.OPENCHART_PROVIDER_SMOKE_CREDENTIAL_FILE;
const soakMs = Number(process.env.OPENCHART_PROVIDER_SOAK_MS ?? 0);
test.skipIf(!credentialFile)(
  "real OpenChart: search, history, minute/day/week/month streaming and alerts",
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
      models: { fetchEnabled: false, userAgent: "openchart-provider-smoke" },
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
          const f = await runtime.runPromise(feed.get());
          const s = await runtime.runPromise(f.symbology.indexStatus());
          expect(s.find((v) => v.providerId === "openchart")?.available).toBe(
            true,
          );
        },
        { timeout: 15000 },
      );
      const services = await runtime.runPromise(feed.get());
      const hits = await runtime.runPromise(
        services.symbology.search({
          query: "BTC/USD",
          assetClass: "crypto",
          limit: 200,
          indexed: false,
        }),
      );
      const btc = hits.find((h) => h.listing.id === 12526);
      expect(btc).toBeDefined();
      const stock = await runtime.runPromise(
        services.symbology.search({
          query: "AAPL",
          assetClass: "stock",
          limit: 20,
          indexed: false,
        }),
      );
      expect(stock.some((h) => h.listing.symbol === "AAPL")).toBe(true);
      for (const resolution of [
        "1s",
        "1m",
        "5m",
        "15m",
        "30m",
        "1h",
        "4h",
        "1d",
        "1W",
        "1M",
      ] as const) {
        const from =
          Date.now() -
          {
            "1s": 300000,
            "1m": 3600000,
            "5m": 86400000,
            "15m": 86400000,
            "30m": 86400000 * 2,
            "1h": 86400000 * 3,
            "4h": 86400000 * 5,
            "1d": 86400000 * 10,
            "1W": 86400000 * 35,
            "1M": 86400000 * 90,
          }[resolution];
        await runtime.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const observed = yield* services.bars.observe(
                Schema.decodeUnknownSync(BarsRequest)({
                  ...btc,
                  resolution,
                  session: "regular",
                  adjustment: "split",
                  from,
                  to: "now",
                  countBack: 5,
                }),
              );
              expect(observed.snapshot.data.numRows).toBeGreaterThan(0);
              const frames = yield* observed.updates!.pipe(
                Stream.take(2),
                Stream.runCollect,
                Effect.timeout("45 seconds"),
              );
              expect(frames.length).toBe(2);
              expect(frames[1]!.get(0)!.time).toBeGreaterThanOrEqual(
                frames[0]!.get(0)!.time,
              );
              console.log("OpenChart production series verified", {
                resolution,
                history: observed.snapshot.data.numRows,
                first: frames[0]!.get(0)?.time,
                latest: frames[1]!.get(0)?.close,
              });
            }),
          ),
        );
      }
      const events = await runtime.runPromise(
        new TeaAlerts({
          source:
            'alertcondition("smoke", close > 0, "OpenChart smoke", "Observed live price")',
          config: {
            ...Tea.barsInputs(
              Schema.decodeUnknownSync(BarsSeries)({
                ...btc!,
                resolution: "1m",
                session: "regular",
                adjustment: "split",
              }),
            ),
            parameters: {},
            requests: {},
          },
          warmupBars: 2,
        })
          .observe()
          .pipe(
            Stream.flattenIterable,
            Stream.take(1),
            Stream.runCollect,
            Effect.scoped,
            Effect.timeout("45 seconds"),
          ),
      );
      expect(events[0]?.data).toMatchObject({
        inputs: { provider: "openchart" },
      });
      console.log("OpenChart production alert verified", {
        events: events.length,
        time: events[0]?.time,
      });
      const aapl = stock.find((h) => h.listing.symbol === "AAPL")!;
      const tea = await runtime.runPromise(Tea.Service);
      const rsi = await runtime.runPromise(
        tea.compile({
          entry: "<inline>",
          sources: { "<inline>": 'plot("rsi", ta.rsi(close, 14))' },
        }),
      );
      try {
        // A wider observation is the same server operation used when panning left.
        for (const from of [
          Date.parse("2025-01-01"),
          Date.parse("2020-01-01"),
        ]) {
          await runtime.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const observed = yield* tea.observe(
                  teaRequest({
                    id: rsi.id,
                    parameters: {},
                    inputs: {
                      ...aapl,
                      resolution: "1W",
                      session: "regular",
                      adjustment: "split",
                    },
                    requests: {},
                    from,
                    to: "now",
                    countBack: 100,
                  }),
                );
                expect(observed.snapshot.data.numRows).toBeGreaterThan(0);
                const frames = yield* observed.updates!.pipe(
                  Stream.take(1),
                  Stream.runCollect,
                  Effect.timeout("30 seconds"),
                );
                expect(frames[0]!.numRows).toBeGreaterThan(0);
                console.log(
                  "OpenChart AAPL weekly RSI history expansion verified",
                  {
                    from,
                    history: observed.snapshot.data.numRows,
                    liveRows: frames[0]!.numRows,
                  },
                );
              }),
            ),
          );
        }
        if (soakMs > 0) {
          await runtime.runPromise(
            Effect.all(
              ["1m", "1d", "1W", "1M"].map((resolution) =>
                Effect.scoped(
                  Effect.gen(function* () {
                    const started = Date.now();
                    const observed = yield* tea.observe(
                      teaRequest({
                        id: rsi.id,
                        parameters: {},
                        inputs: {
                          ...btc!,
                          resolution,
                          session: "regular",
                          adjustment: "split",
                        },
                        requests: {},
                        from:
                          started -
                          (resolution === "1m" ? 3600000 : 86400000 * 90),
                        to: "now",
                        countBack: 100,
                      }),
                    );
                    let updates = 0,
                      lastReceived = 0,
                      reported = started;
                    yield* observed.updates!.pipe(
                      Stream.tap(() =>
                        Effect.sync(() => {
                          updates++;
                          lastReceived = Date.now();
                          if (lastReceived - reported >= 60000) {
                            console.log("OpenChart RSI sustained stream", {
                              resolution,
                              updates,
                              elapsedSeconds: Math.round(
                                (lastReceived - started) / 1000,
                              ),
                            });
                            reported = lastReceived;
                          }
                        }),
                      ),
                      Stream.interruptWhen(Effect.sleep(`${soakMs} millis`)),
                      Stream.runDrain,
                    );
                    expect(updates).toBeGreaterThan(2);
                    expect(lastReceived - started).toBeGreaterThan(
                      soakMs - 60000,
                    );
                    console.log("OpenChart RSI sustained stream passed", {
                      resolution,
                      updates,
                      elapsedSeconds: Math.round(
                        (lastReceived - started) / 1000,
                      ),
                    });
                  }),
                ),
              ),
              { concurrency: "unbounded" },
            ),
          );
        }
      } finally {
        await runtime.runPromise(tea.dispose({ id: rsi.id }));
      }
    } finally {
      await runtime.dispose();
    }
  },
  180000 + soakMs,
);
