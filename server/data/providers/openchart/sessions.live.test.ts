// Purpose: Opt-in session acceptance through the App's real Provider and Feed.
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
import { BarsRequest } from "@openchart/feed";

const credentialFile = process.env.OPENCHART_PROVIDER_SMOKE_CREDENTIAL_FILE;
const sessions = ["regular", "extended", "24h"] as const;

test.skipIf(!credentialFile || !process.env.OPENCHART_PROVIDER_SESSIONS)(
  "App sessions: stock coverage, official calendar bars, refresh and crypto live",
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
      openchartUrl: process.env.OPENCHART_PROVIDER_SMOKE_URL,
      auth: { integrationID: OPENCHART_CLOUD.integrationID },
      integrations: { methods: [OPENCHART_CLOUD] },
      config: ConfigProvider.fromUnknown({
        providers: {
          binance: { enabled: false },
          yfinance: { enabled: false },
        },
      }),
      models: {
        fetchEnabled: false,
        userAgent: "openchart-session-acceptance",
      },
    });
    try {
      await router.createCaller({ runtime }).access.auth.completeSignIn({
        apiKeyID: saved.keyId,
        key: saved.key,
        user: {
          id: saved.user,
          email: "openchart-dev+clerk_test@longsurf.ai",
          firstName: "OpenChart",
          lastName: "Test",
        },
      });
      const feed = await runtime.runPromise(Feed);
      await vi.waitFor(
        async () => {
          const services = await runtime.runPromise(feed.get());
          const status = await runtime.runPromise(
            services.symbology.indexStatus(),
          );
          expect(
            status.find((v) => v.providerId === "openchart")?.available,
          ).toBe(true);
        },
        { timeout: 20000 },
      );
      const services = await runtime.runPromise(feed.get());
      const stocks = await runtime.runPromise(
        services.symbology.search({
          query: "AAPL",
          assetClass: "stock",
          limit: 30,
          indexed: false,
        }),
      );
      const aapl = stocks.find(
        (hit) => hit.provider === "openchart" && hit.listing.id === 26,
      );
      expect(aapl).toBeDefined();
      const history = (
        session: (typeof sessions)[number],
        resolution: string,
        from: string,
        to: string,
      ) =>
        runtime.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const observed = yield* services.bars.observe(
                Schema.decodeUnknownSync(BarsRequest)({
                  ...aapl,
                  session,
                  resolution,
                  adjustment: "raw",
                  from: Date.parse(from),
                  to: Date.parse(to),
                  countBack: 1,
                }),
              );
              const frame = observed.snapshot.data;
              expect(frame.numRows).toBeGreaterThan(0);
              return Array.from({ length: frame.numRows }, (_, index) => {
                const { time, open, high, low, close, volume } =
                  frame.get(index)!;
                return { time, open, high, low, close, volume };
              });
            }),
          ),
        );
      const start = "2026-09-30T04:00:00Z",
        end = "2026-10-01T04:00:00Z";
      const regular = await history("regular", "1m", start, end);
      const extended = await history("extended", "1m", start, end);
      const allHours = await history("24h", "1m", start, end);
      expect(regular.length).toBeGreaterThan(100);
      expect(extended.length).toBeGreaterThan(regular.length);
      expect(allHours.length).toBeGreaterThanOrEqual(extended.length);
      expect(
        regular.every(
          (row) =>
            row.time >= Date.parse("2026-09-30T13:30:00Z") &&
            row.time < Date.parse("2026-09-30T20:00:00Z"),
        ),
      ).toBe(true);
      expect(extended.some((row) => row.time < regular[0]!.time)).toBe(true);
      expect(extended.some((row) => row.time > regular.at(-1)!.time)).toBe(
        true,
      );
      const byTime = new Map(extended.map((row) => [row.time, row]));
      for (const row of regular) expect(byTime.get(row.time)).toEqual(row);
      // Returning to Regular must not reuse another session's cached rows.
      expect(await history("regular", "1m", start, end)).toEqual(regular);
      for (const resolution of ["1h", "4h"] as const) {
        for (const session of sessions) {
          const rows = await history(session, resolution, start, end);
          if (session === "regular")
            expect(rows[0]!.time).toBe(Date.parse("2026-09-30T13:30:00Z"));
          expect(
            rows.every(
              (row) =>
                row.low !== null &&
                row.open !== null &&
                row.close !== null &&
                row.high !== null &&
                row.low <= row.open &&
                row.low <= row.close &&
                row.high >= row.open &&
                row.high >= row.close,
            ),
          ).toBe(true);
        }
      }
      for (const resolution of ["1d", "1W", "1M"] as const) {
        const official = await history(
          "regular",
          resolution,
          "2026-08-01",
          "2026-10-01",
        );
        expect(
          await history("extended", resolution, "2026-08-01", "2026-10-01"),
        ).toEqual(official);
        expect(
          await history("24h", resolution, "2026-08-01", "2026-10-01"),
        ).toEqual(official);
      }
      const crypto = await runtime.runPromise(
        services.symbology.search({
          query: "BTC/USD",
          assetClass: "crypto",
          limit: 100,
          indexed: false,
        }),
      );
      const btc = crypto.find(
        (hit) => hit.provider === "openchart" && hit.listing.id === 12526,
      );
      expect(btc).toBeDefined();
      for (const session of sessions) {
        await runtime.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const observed = yield* services.bars.observe(
                Schema.decodeUnknownSync(BarsRequest)({
                  ...btc,
                  session,
                  resolution: "1m",
                  adjustment: "raw",
                  from: Date.now() - 3600000,
                  to: "now",
                  countBack: 5,
                }),
              );
              expect(observed.snapshot.data.numRows).toBeGreaterThan(0);
              const updates = yield* observed.updates!.pipe(
                Stream.take(2),
                Stream.runCollect,
                Effect.timeout("45 seconds"),
              );
              expect(updates.length).toBe(2);
              expect(updates[1]!.get(0)!.time).toBeGreaterThanOrEqual(
                updates[0]!.get(0)!.time,
              );
              console.log("App session live verified", {
                session,
                history: observed.snapshot.data.numRows,
                updates: updates.length,
              });
            }),
          ),
        );
      }
      console.log("App stock sessions verified", {
        regular: regular.length,
        extended: extended.length,
        allHours: allHours.length,
      });
    } finally {
      await runtime.dispose();
    }
  },
  240000,
);
