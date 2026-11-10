// Purpose: Prove retired market-data settings cannot reactivate a provider or rewrite saved identities.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";
import { BarsRequest, FeedError } from "@openchart/feed";
import { Feed } from "@openchart/server/feed/service";
import { makeRuntime } from "@openchart/server/runtime";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { router } from "@openchart/server";
import { upstream } from "@openchart/server/tea/errors";

const request = Schema.decodeUnknownSync(BarsRequest)({
  provider: "openchart",
  listing: { id: 12526, symbol: "AAPL", currency: "USD" },
  resolution: "1d",
  session: "regular",
  adjustment: "raw",
  from: 0,
  to: 86400000,
  countBack: 1,
});

async function fixture() {
  const home = temporaryHome();
  const settings = {
    providers: {
      openchart: { enabled: true },
      binance: { enabled: false },
      yfinance: { enabled: false },
      tradingview: { enabled: false },
    },
    openchart: { baseUrl: "not-a-url", requestTimeout: "not-a-duration" },
  };
  await writeFile(join(home, "settings.json"), JSON.stringify(settings));
  const runtime = makeRuntime({
    home,
    databasePath: ":memory:",
    models: { fetchEnabled: false, userAgent: "retirement-test" },
  });
  await runtime.context();
  const caller = router.createCaller({ runtime });
  const feed = await runtime.runPromise(
    Feed.pipe(Effect.flatMap((value) => value.get())),
  );
  return { home, settings, runtime, caller, feed };
}

test("retired settings survive writes but cannot register, configure or advertise OpenChart", async () => {
  const f = await fixture();
  try {
    const publicSettings = await f.caller.config.get();
    expect(publicSettings.providers).not.toHaveProperty("openchart");
    expect(
      await f.runtime.runPromise(f.feed.symbology.indexStatus()),
    ).not.toContainEqual(expect.objectContaining({ providerId: "openchart" }));
    await f.caller.config.update({
      providers: { yfinance: { enabled: false } },
    });
    const saved = JSON.parse(
      await readFile(join(f.home, "settings.json"), "utf8"),
    );
    expect(saved.providers.openchart).toEqual(f.settings.providers.openchart);
    expect(saved.openchart).toEqual(f.settings.openchart);
    await expect(
      f.caller.providers.checkAccess({
        // @ts-expect-error Retired providers cannot be configured through the public API.
        providerId: "openchart",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  } finally {
    await f.runtime.dispose();
  }
});

test("old bars and calendars fail permanently with original identity and safe Tea wording", async () => {
  const f = await fixture();
  try {
    const reads: Effect.Effect<unknown, FeedError>[] = [
      f.feed.bars.observe(request).pipe(Effect.scoped),
      f.feed.bars.getCapabilities(request),
      f.feed.calendar.getCalendar({
        provider: request.provider,
        listing: request.listing,
        start: 0,
        end: 86400000,
        timezone: "UTC",
      }),
    ];
    for (const read of reads) {
      const error = await f.runtime.runPromise(read.pipe(Effect.flip));
      expect(error).toBeInstanceOf(FeedError);
      expect(error.reason).toMatchObject({
        _tag: "Feed.SourceRetired",
        provider: "openchart",
      });
      expect(error.isRetryable).toBe(false);
      expect(upstream(error).message).toContain("has been retired");
      expect(upstream(error).cause).toBe(error);
    }
    expect(request.provider).toBe("openchart");
    expect(request.listing.id).toBe(12526);
  } finally {
    await f.runtime.dispose();
  }
});
