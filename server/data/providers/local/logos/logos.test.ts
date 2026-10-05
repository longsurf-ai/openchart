// Purpose: Keep exact aliases, fuzzy ambiguity, bundled assets and source failures honest.
import * as fs from "node:fs/promises";
import { Effect, Exit, Schema } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import { logosFeed } from "@openchart/server/feed/logo/logo";
import { LogoCatalog, logoSearch } from "./catalog";
import { makeLogosDataset } from "./logos";

vi.mock("node:fs/promises", async (original) => {
  const module = await original<typeof import("node:fs/promises")>();
  return { ...module, readFile: vi.fn(module.readFile) };
});

afterEach(() => vi.restoreAllMocks());

test("exact aliases win; short, weak, tied and colliding identifiers never guess", () => {
  const rows = Schema.decodeUnknownSync(LogoCatalog)(
    [
      {
        id: "crypto:btc",
        name: "Bitcoin",
        asset: "crypto/btc.svg",
        identifiers: [
          "BTC",
          "Bitcoin",
          "BTCUSD",
          "BTCUSDT",
          "BTC/USDC",
          "BTC-USD",
          "BTC_ETH",
        ],
      },
      {
        id: "brand:one",
        name: "Bitcoin Cash",
        asset: "brands/one.jpg",
        identifiers: ["Bitcoin Cash", "shared"],
      },
      {
        id: "brand:two",
        name: "Bitcoind",
        asset: "brands/two.jpg",
        identifiers: ["Bitcoind", "shared"],
      },
    ].map((row) => ({
      ...row,
      listings: [
        {
          symbol: "BTCUSDT",
          exchange: "Binance",
          source: "https://data-api.binance.vision/api/v3/exchangeInfo",
        },
      ],
    })),
  );
  const search = logoSearch(rows);
  for (const alias of [
    " btc ",
    "BITCOIN",
    "BTCUSD",
    "BTCUSDT",
    "BTC/USDC",
    "BTC-USD",
    "BTC_ETH",
  ])
    expect(search(alias).map((row) => row.id)).toEqual(["crypto:btc"]);
  expect(search("Bitco")).toHaveLength(3);
  expect(search("shared")).toHaveLength(2);
  for (const unknown of [
    "",
    "B",
    "BT",
    "BCT",
    "not a brand",
    "BTCUNKNOWN",
    "NVDAUSDT",
  ])
    expect(search(unknown)).toEqual([]);
  const onlyBitcoin = logoSearch([rows[0]!]);
  for (const typo of ["Bitcion", "Bitcoim", "Bitcon", "Bitcoinn"])
    expect(onlyBitcoin(typo)[0]?.id).toBe("crypto:btc");
  expect(() =>
    Schema.decodeUnknownSync(LogoCatalog)([rows[0], rows[0]]),
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(LogoCatalog)([
      { ...rows[0], asset: "../../secret.jpg" },
    ]),
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(LogoCatalog)([{ ...rows[0], listings: [] }]),
  ).toThrow();
  const canonical = { ...rows[0]!, identifiers: ["BTC"] };
  const collision = { ...rows[1]!, identifiers: ["crypto:BTC"] };
  expect(logoSearch([canonical, collision])("crypto:BTC")).toEqual([canonical]);
});

test("ships only referenced listed assets and covers major corporations and explicit crypto pairs", async () => {
  const assets = new URL("./assets/", import.meta.url);
  const catalog = Schema.decodeUnknownSync(Schema.fromJsonString(LogoCatalog))(
    await fs.readFile(new URL("catalog.json", assets), "utf8"),
  );
  expect(catalog).toHaveLength(1087);
  const files = (
    await Promise.all(
      ["brands", "company", "crypto"].map(async (folder) =>
        (await fs.readdir(new URL(`${folder}/`, assets)))
          .filter((name) => /\.(jpg|png|svg)$/.test(name))
          .map((name) => `${folder}/${name}`),
      ),
    )
  ).flat();
  expect(new Set(catalog.map((entry) => entry.asset))).toEqual(new Set(files));
  for (const entry of catalog) await fs.access(new URL(entry.asset, assets));
  const coverage = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        symbols: Schema.Array(Schema.String),
        international: Schema.Struct({
          listings: Schema.Array(
            Schema.Struct({ symbol: Schema.String, exchange: Schema.String }),
          ),
        }),
      }),
    ),
  )(
    await fs.readFile(
      new URL("./large-cap-coverage.json", import.meta.url),
      "utf8",
    ),
  );
  expect(coverage.symbols).toHaveLength(101);
  const search = logoSearch(catalog);
  for (const entry of catalog)
    for (const identifier of entry.identifiers)
      expect(
        search(identifier).map((match) => match.id),
        identifier,
      ).toContain(entry.id);
  for (const symbol of coverage.symbols) {
    const matches = search(`stock:${symbol}`);
    expect(matches, symbol).toHaveLength(1);
    expect(matches[0]!.id).toMatch(/^brand:/);
    expect(
      matches[0]!.listings.some((listing) => listing.symbol === symbol),
    ).toBe(true);
  }
  expect(coverage.international.listings).toHaveLength(65);
  for (const listing of coverage.international.listings) {
    const identifier = `${listing.exchange}:${listing.symbol}`;
    const matches = search(identifier);
    expect(matches, identifier).toHaveLength(1);
    expect(
      matches[0]!.listings.some(
        (item) =>
          item.symbol === listing.symbol && item.exchange === listing.exchange,
      ),
    ).toBe(true);
  }
  for (const [identifier, id] of [
    ["0700.HK", "brand:tencent.com"],
    ["005930.KS", "brand:samsung.com"],
    ["NESN.SW", "brand:nestle.com"],
    ["2330.TW", "brand:tsmc.com"],
    ["MC.PA", "brand:lvmh.com"],
    ["ASML.AS", "brand:asml.com"],
    ["NYSE:ABT", "brand:abbott.com"],
    ["crypto:ABT", "crypto:abt"],
    ["crypto:TUSD", "crypto:tusd"],
    ["NANOUSD", "crypto:xno"],
    ["MATICUSDT", "crypto:pol"],
    ["PAXUSD", "crypto:usdp"],
    ["BTTUSD", "crypto:bttc"],
  ] as const)
    expect(
      search(identifier).map((row) => row.id),
      identifier,
    ).toEqual([id]);
  expect(search("ABT")).toHaveLength(2);
  for (const entry of catalog.filter((row) => row.id.startsWith("crypto:"))) {
    const symbol = entry.id.slice(7).toUpperCase();
    if (symbol !== "USD") expect(entry.identifiers).toContain(`${symbol}USD`);
    if (symbol !== "USDT") expect(entry.identifiers).toContain(`${symbol}USDT`);
  }
  for (const domain of [
    "anthropic.com",
    "openai.com",
    "bbc.com",
    "lucid.app",
    "genius.com",
    "pandora.com",
  ])
    expect(catalog.some((row) => row.id === `brand:${domain}`)).toBe(false);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const dataset = yield* makeLogosDataset();
        const feed = logosFeed([dataset]);
        for (const identifier of [
          "BTC",
          "Bitcoin",
          "BTCUSD",
          "BTCUSDT",
          "BTC-USD",
          "Bitcion",
        ])
          expect(yield* feed.getLogo({ identifier })).toMatchObject({
            id: "crypto:btc",
            url: expect.stringMatching(/^data:image\/png;base64,/),
          });
        const apple = yield* feed.getLogo({ identifier: "Apple" });
        expect(apple).toMatchObject({
          id: "brand:apple.com",
          url: expect.stringMatching(/^data:image\/jpeg;base64,/),
        });
        expect(yield* feed.getLogo({ identifier: "AAPL" })).toEqual(apple);
        expect(yield* feed.getLogo({ identifier: "Apple Inc." })).toEqual(
          apple,
        );
        expect(
          yield* feed.getLogo({ identifier: "microsoft.com" }),
        ).toMatchObject({ id: "brand:microsoft.com" });
        expect(yield* feed.getLogo({ identifier: "AliExpress" })).toBeNull();
        expect(
          yield* feed.getLogo({ identifier: "no such logo 908172" }),
        ).toBeNull();
      }),
    ),
  );
});

test("missing source and broken image reads remain errors instead of missing logos", async () => {
  await expect(
    Effect.runPromise(logosFeed().getLogo({ identifier: "BTC" })),
  ).rejects.toMatchObject({ reason: { _tag: "Feed.SourceUnavailable" } });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const dataset = yield* makeLogosDataset();
        vi.spyOn(fs, "readFile").mockRejectedValueOnce(
          new Error("missing bundled image"),
        );
        const exit = yield* logosFeed([dataset])
          .getLogo({ identifier: "BTC" })
          .pipe(Effect.exit);
        // A broken bundle is a packaging defect, not a public Feed reason.
        expect(Exit.hasDies(exit)).toBe(true);
        expect(Exit.findDefect(exit)).toMatchObject({
          success: { reason: { _tag: "Dataset.InvalidResult" } },
        });
      }),
    ),
  );
});
