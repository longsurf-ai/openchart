// Purpose: Preserve diverse real captures and stable assignments without per-open market requests.
import { createHash } from "node:crypto";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
  assignIndicatorExamples,
  indicatorExampleForKey,
  indicatorExampleManifest,
  indicatorExampleQueryOptions,
  parseIndicatorExample,
} from "@openchart/app/features/chart/api/indicator-examples";
import aapl from "@openchart/app/features/chart/assets/market-examples/aapl-2024-1d.json";

const assets = Object.values(
  import.meta.glob<typeof aapl>(
    "/src/features/chart/assets/market-examples/*-1d.json",
    { eager: true, import: "default" },
  ),
);
const assetById = new Map(assets.map((asset) => [asset.id, asset]));
const periodAssets = new Map(
  Object.values(
    import.meta.glob<typeof aapl>(
      [
        "/src/features/chart/assets/market-examples/*-1W.json",
        "/src/features/chart/assets/market-examples/*-1M.json",
      ],
      { eager: true, import: "default" },
    ),
  ).map((asset) => [asset.id, asset]),
);
const day = 86_400_000;
const acquiredFrom = Date.parse("2021-01-01T00:00:00Z");
const cutoff = Date.parse("2025-01-01T00:00:00Z");
// Source-native venues are retained rather than translated to exchange names.
const identities: Readonly<Record<string, readonly [string, string]>> = {
  AAPL: ["stock", "NMS"],
  MSFT: ["stock", "NMS"],
  NVDA: ["stock", "NMS"],
  AMZN: ["stock", "NMS"],
  GOOGL: ["stock", "NMS"],
  META: ["stock", "NMS"],
  TSLA: ["stock", "NMS"],
  AMD: ["stock", "NMS"],
  INTC: ["stock", "NMS"],
  JPM: ["stock", "NYQ"],
  XOM: ["stock", "NYQ"],
  UNH: ["stock", "NYQ"],
  PFE: ["stock", "NYQ"],
  DIS: ["stock", "NYQ"],
  BA: ["stock", "NYQ"],
  WMT: ["stock", "NMS"],
  SPY: ["etf", "PCX"],
  IWM: ["etf", "PCX"],
  GLD: ["etf", "PCX"],
  XLE: ["etf", "PCX"],
  QQQ: ["etf", "NGM"],
  TLT: ["etf", "NGM"],
  BTCUSDT: ["crypto", "Binance"],
  ETHUSDT: ["crypto", "Binance"],
  SOLUSDT: ["crypto", "Binance"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("packages fifty distinct histories for twenty-five instruments across 2022 and 2024", () => {
  expect(indicatorExampleManifest).toHaveLength(50);
  expect(assets).toHaveLength(50);
  expect(new Set(indicatorExampleManifest.map(({ id }) => id)).size).toBe(50);
  expect(new Set(assets.map(({ provenance }) => provenance.sha256)).size).toBe(
    50,
  );
  expect(new Set(indicatorExampleManifest.map(({ symbol }) => symbol))).toEqual(
    new Set(Object.keys(identities)),
  );
  expect(new Set(indicatorExampleManifest.map(({ year }) => year))).toEqual(
    new Set([2022, 2024]),
  );
  expect(new Set(indicatorExampleManifest.map(({ id }) => id))).toEqual(
    new Set(assetById.keys()),
  );
  for (const symbol of Object.keys(identities)) {
    expect(
      indicatorExampleManifest
        .filter((entry) => entry.symbol === symbol)
        .map(({ year }) => year)
        .sort(),
    ).toEqual([2022, 2024]);
  }
});

it.each(indicatorExampleManifest)(
  "preserves $id acquired prices, identity, provenance and warmup",
  ({ id, provider, symbol, year }) => {
    const asset = assetById.get(id)!;
    const example = parseIndicatorExample(asset);
    const crypto = provider === "binance";
    const displayFrom = Date.UTC(year, 0, 1);
    const displayTo = Date.UTC(year + 1, 0, 1);
    const warmupFrom = Date.UTC(year - 1, 0, 1);
    const visibleCount = crypto
      ? year === 2022
        ? 365
        : 366
      : year === 2022
        ? 251
        : 252;
    const rowCount = crypto
      ? year === 2022
        ? 730
        : 731
      : year === 2022
        ? 503
        : 502;
    const [assetClass, venue] = identities[symbol]!;
    expect(example.id).toBe(`${symbol.toLowerCase()}-${year}-1d`);
    expect(example.series).toEqual({
      provider,
      listing: {
        symbol,
        name: asset.instrument.listing.name,
        currency: crypto ? "USDT" : "USD",
        venue,
        class: assetClass,
      },
      resolution: "1d",
      session: crypto ? "24h" : "regular",
      adjustment: crypto ? "raw" : "split",
    });
    expect(example.provenance).toMatchObject({
      requestedRange: { from: acquiredFrom, to: cutoff },
      firstBarTime: asset.bars[0]![0],
      lastBarTime: asset.bars.at(-1)![0],
      rowCount,
      sha256: createHash("sha256")
        .update(JSON.stringify(asset.bars))
        .digest("hex"),
    });
    expect(Number.isFinite(Date.parse(example.provenance.retrievedAt))).toBe(
      true,
    );
    expect(example.provenance.sourceUrls.length).toBeGreaterThan(0);
    expect(example.provenance.sourceUrls).toContain(
      example.provenance.sourceUrl,
    );
    for (const sourceUrl of example.provenance.sourceUrls) {
      const url = new URL(sourceUrl);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe(
        crypto ? "data-api.binance.vision" : "query1.finance.yahoo.com",
      );
      expect(url.searchParams.get("interval")).toBe("1d");
      expect(
        crypto
          ? url.searchParams.get("symbol")
          : url.pathname.split("/").at(-1),
      ).toBe(symbol);
    }
    expect(example.rows).toHaveLength(rowCount);
    expect(example.from).toBe(displayFrom);
    expect(example.to).toBe(displayTo);
    expect(
      example.rows.filter(
        ({ time }) => time >= example.from && time < example.to,
      ),
    ).toHaveLength(visibleCount);
    expect(
      example.rows.filter(({ time }) => time < example.from).length,
    ).toBeGreaterThanOrEqual(250);
    expect(
      example.rows.map(({ time, open, high, low, close, volume }) => [
        time,
        open,
        high,
        low,
        close,
        volume,
      ]),
    ).toEqual(asset.bars);
    expect(
      example.rows.every(
        ({ time }, index, rows) =>
          time >= warmupFrom &&
          time < displayTo &&
          (index === 0 || time > rows[index - 1]!.time),
      ),
    ).toBe(true);
    expect(Object.isFrozen(example)).toBe(true);
    expect(Object.isFrozen(example.rows)).toBe(true);
    expect(example.rows.every(Object.isFrozen)).toBe(true);
    expect(Reflect.set(example.rows[0]!, "close", 0)).toBe(false);
    expect(Reflect.set(example.rows, "0", example.rows[1])).toBe(false);
  },
);

it.each(indicatorExampleManifest)(
  "packages $id's weeks and months: the same market and years, as Feed names them",
  ({ id, provider, symbol }) => {
    const daily = parseIndicatorExample(assetById.get(id)!);
    for (const resolution of ["1W", "1M"] as const) {
      const asset = periodAssets.get(id.replace(/-1d$/, `-${resolution}`));
      expect(asset).toBeDefined();
      const capture = parseIndicatorExample(asset);
      expect(capture.series).toEqual({ ...daily.series, resolution });
      expect([capture.from, capture.to]).toEqual([daily.from, daily.to]);
      expect(capture.provenance.requestedRange).toEqual(
        daily.provenance.requestedRange,
      );
      for (const sourceUrl of capture.provenance.sourceUrls) {
        const url = new URL(sourceUrl);
        expect(url.searchParams.get("interval")).toBe(
          provider === "binance"
            ? { "1W": "1w", "1M": "1M" }[resolution]
            : { "1W": "1wk", "1M": "1mo" }[resolution],
        );
        expect(
          provider === "binance"
            ? url.searchParams.get("symbol")
            : url.pathname.split("/").at(-1),
        ).toBe(symbol);
      }
      // Weeks open on Mondays and months on the 1st, at the market's
      // midnight, as its daily bars do: New York's for stocks and funds,
      // UTC for crypto.
      const calendar = new Intl.DateTimeFormat("en-US", {
        timeZone: provider === "binance" ? "UTC" : "America/New_York",
        weekday: "short",
        day: "numeric",
        hour: "numeric",
        hourCycle: "h23",
      });
      for (const { time } of capture.rows) {
        const date = Object.fromEntries(
          calendar.formatToParts(time).map(({ type, value }) => [type, value]),
        );
        expect(Number(date.hour)).toBe(0);
        expect(resolution === "1W" ? date.weekday : date.day).toBe(
          resolution === "1W" ? "Mon" : "1",
        );
      }
    }
  },
);

it("rejects captures whose provenance no longer describes their bars", () => {
  for (const provenance of [
    { ...aapl.provenance, rowCount: aapl.provenance.rowCount + 1 },
    { ...aapl.provenance, firstBarTime: aapl.provenance.firstBarTime + day },
    { ...aapl.provenance, lastBarTime: aapl.provenance.lastBarTime - day },
  ]) {
    expect(() => parseIndicatorExample({ ...aapl, provenance })).toThrow(
      "does not match its provenance",
    );
  }
  expect(() =>
    parseIndicatorExample({
      ...aapl,
      provenance: { ...aapl.provenance, sha256: "invalid" },
    }),
  ).toThrow();
});

it("rejects duplicate or unordered history rather than sorting away a corrupt capture", () => {
  const duplicate = structuredClone(aapl);
  duplicate.bars[1]![0] = duplicate.bars[0]![0]!;
  expect(() => parseIndicatorExample(duplicate)).toThrow("strictly ascend");
  const unordered = structuredClone(aapl);
  [unordered.bars[1], unordered.bars[2]] = [
    unordered.bars[2]!,
    unordered.bars[1]!,
  ];
  expect(() => parseIndicatorExample(unordered)).toThrow("strictly ascend");
});

it("rejects history outside the acquired range or a display window without captured bars", () => {
  expect(() =>
    parseIndicatorExample({
      ...aapl,
      provenance: {
        ...aapl.provenance,
        requestedRange: { from: aapl.provenance.firstBarTime + 1, to: cutoff },
      },
    }),
  ).toThrow("exceed their acquired range");
  expect(() =>
    parseIndicatorExample({
      ...aapl,
      displayRange: { from: acquiredFrom - day, to: cutoff },
    }),
  ).toThrow("needs acquired history");
  expect(() =>
    parseIndicatorExample({
      ...aapl,
      displayRange: {
        from: Date.parse("2024-01-06T00:00:00Z"),
        to: Date.parse("2024-01-08T00:00:00Z"),
      },
    }),
  ).toThrow("needs acquired history");
});

const studyIds = Array.from(
  { length: 70 },
  (_, index) => `study-${String(index).padStart(2, "0")}`,
);

it("assigns all fifty examples evenly and reproducibly across a seventy-study catalogue", () => {
  const originalIds = [...studyIds];
  const assignments = assignIndicatorExamples(originalIds);
  expect(originalIds).toEqual(studyIds);
  expect(assignments.size).toBe(70);
  expect(new Set(assignments.values())).toEqual(
    new Set(indicatorExampleManifest.map(({ id }) => id)),
  );
  expect(
    new Set(studyIds.slice(0, 50).map((id) => assignments.get(id))).size,
  ).toBe(50);
  for (const { id } of indicatorExampleManifest) {
    const uses = Array.from(assignments.values()).filter(
      (assigned) => assigned === id,
    ).length;
    expect(uses === 1 || uses === 2).toBe(true);
  }
  expect(assignIndicatorExamples([...studyIds].reverse())).toEqual(assignments);
  expect(
    assignIndicatorExamples([...studyIds.slice(35), ...studyIds.slice(0, 35)]),
  ).toEqual(assignments);
});

it("keeps card and detail examples stable when browsing a filtered or reordered catalogue", () => {
  const assignments = assignIndicatorExamples(studyIds);
  // Filtering selects from the complete catalogue's assignment rather than recomputing ranks.
  const filtered = studyIds.filter((_, index) => index % 7 === 0).reverse();
  const cards = filtered.map((id) => ({ id, exampleId: assignments.get(id) }));
  const reopened = assignIndicatorExamples([...studyIds].reverse());
  for (const card of cards) {
    expect(card.exampleId).toBeDefined();
    expect(reopened.get(card.id)).toBe(card.exampleId);
    expect(assignments.get(card.id)).toBe(card.exampleId);
  }
});

it("gives personal scripts a deterministic bundled fallback independent of browsing order", () => {
  const keys = [
    "workspace-a:studies/rsi.tea",
    "workspace-a:studies/trend.tea",
    "workspace-b:studies/rsi.tea",
  ];
  const first = new Map(keys.map((key) => [key, indicatorExampleForKey(key)]));
  const validIds = new Set(indicatorExampleManifest.map(({ id }) => id));
  for (const key of [...keys].reverse()) {
    expect(indicatorExampleForKey(key)).toBe(first.get(key));
    expect(validIds.has(indicatorExampleForKey(key))).toBe(true);
  }
});

it("loads each bundled history once across library closes, elapsed time and reopen without fetch", async () => {
  vi.useFakeTimers();
  const network = vi.fn(() => {
    throw new Error("Historical examples must not fetch market data");
  });
  vi.stubGlobal("fetch", network);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  try {
    for (const { id } of indicatorExampleManifest) {
      const options = indicatorExampleQueryOptions(id);
      if (typeof options.queryFn !== "function")
        throw new Error("Example loader is missing");
      const load = vi.fn(options.queryFn);
      const cachedOptions = { ...options, queryFn: load };
      const first = await client.fetchQuery(cachedOptions);
      expect(first.id).toBe(id);
      expect(first.history.map(({ series }) => series.resolution)).toEqual([
        "1W",
        "1M",
      ]);
      const observer = new QueryObserver(client, cachedOptions);
      const unsubscribe = observer.subscribe(() => {});
      expect(observer.getCurrentResult().data).toBe(first);
      unsubscribe();
      expect(
        client
          .getQueryCache()
          .find({ queryKey: options.queryKey })
          ?.getObserversCount(),
      ).toBe(0);
      await vi.advanceTimersByTimeAsync(7 * day);
      const reopened = new QueryObserver(client, cachedOptions);
      const close = reopened.subscribe(() => {});
      expect(reopened.getCurrentResult().data).toBe(first);
      expect(await client.fetchQuery(cachedOptions)).toBe(first);
      close();
      expect(load).toHaveBeenCalledTimes(1);
    }
    expect(client.getQueryCache().getAll()).toHaveLength(50);
    expect(network).not.toHaveBeenCalled();
  } finally {
    client.clear();
  }
});
