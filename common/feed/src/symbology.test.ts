import { ProviderId, type ProviderListing } from "@openchart/market";
import { expect, test } from "vitest";
import { compareSymbolListings, parseSymbolQuery } from "./symbology";

const provider = ProviderId.make("tradingview");
const listing = (
  symbol: string,
  venue: string,
  primary?: boolean,
): ProviderListing => ({
  provider,
  listing: {
    symbol,
    venue,
    currency: "USD",
    ...(primary === undefined ? {} : { primary }),
  },
});

test("exact symbols rank first, then a source's primary listing, then venue", () => {
  const hits = [
    listing("AAPL", "BCBA"),
    listing("AAPL", "NASDAQ", true),
    listing("AAPLX", "NASDAQ"),
    listing("AAPL", "TSX"),
    listing("A", "NASDAQ"),
  ];
  expect(
    hits
      .sort(compareSymbolListings("AAPL"))
      .map(({ listing }) => [listing.symbol, listing.venue]),
  ).toEqual([
    ["AAPL", "NASDAQ"],
    ["AAPL", "BCBA"],
    ["AAPL", "TSX"],
    ["AAPLX", "NASDAQ"],
    ["A", "NASDAQ"],
  ]);
});

test("without primary flags, equal ranks sort by venue", () => {
  const hits = [
    listing("MSFT", "NASDAQ"),
    listing("MSFT", "BMV"),
    listing("MSFT", "TSX"),
  ];
  expect(
    hits
      .sort(compareSymbolListings("MSFT"))
      .map(({ listing }) => listing.venue),
  ).toEqual(["BMV", "NASDAQ", "TSX"]);
});

test("qualified symbols promote only the requested venue before unrelated results", () => {
  const hits = [
    listing("NQ1!", "OTHER", true),
    listing("49513.HK", "HKEX"),
    listing("NQ1!X", "CME_MINI"),
    listing("NQ1!", "CME_MINI"),
  ];
  expect(
    hits
      .sort(compareSymbolListings(" cme_mini:nq1! "))
      .map(({ listing }) => [listing.symbol, listing.venue]),
  ).toEqual([
    ["NQ1!", "CME_MINI"],
    ["NQ1!X", "CME_MINI"],
    ["49513.HK", "HKEX"],
    ["NQ1!", "OTHER"],
  ]);
});

test.each([
  ["NQ!", "NQ1!"],
  ["CME_MINI:NQ!", "NQ1!"],
  ["NQ2!", "NQ2!"],
])(
  "continuous search %s ranks %s without changing listing identity",
  (query, first) => {
    const hits = [
      listing("49513.HK", "HKEX"),
      listing("NQ2!", "CME_MINI"),
      listing("NQ1!", "CME_MINI"),
    ];
    const original = structuredClone(hits);
    const sorted = [...hits].sort(compareSymbolListings(query));
    expect(sorted[0]?.listing.symbol).toBe(first);
    expect(hits).toEqual(original);
  },
);

test("native symbols containing a colon keep their literal exact rank", () => {
  const hits = [listing("B", "BRK"), listing("BRK:B", "NYSE")];
  expect([...hits].sort(compareSymbolListings("BRK:B"))).toEqual(hits);
  expect(
    compareSymbolListings("BRK:B")(hits[1]!, listing("A", "BRK")),
  ).toBeLessThan(0);
});

test.each([
  ["cme_mini : nq!", { venue: "CME_MINI", symbol: "nq!", continuous: "nq1!" }],
  ["NASDAQ: AAPL", { venue: "NASDAQ", symbol: "AAPL" }],
  ["NQ2!", { symbol: "NQ2!" }],
  ["NQ!!", { symbol: "NQ!!" }],
  ["Apple Inc", { symbol: "Apple Inc" }],
])("query %s parses without inventing a symbol", (query, parsed) => {
  expect(parseSymbolQuery(query)).toEqual(parsed);
});

test("spaces around a venue separator still rank that venue's symbol first", () => {
  const hits = [listing("AAPB", "NASDAQ"), listing("AAPL", "NASDAQ")];
  expect(
    hits.sort(compareSymbolListings("NASDAQ : AAPL"))[0]?.listing.symbol,
  ).toBe("AAPL");
});
