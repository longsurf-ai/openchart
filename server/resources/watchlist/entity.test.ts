// Purpose: Verifies inline metric columns and the recursive section tree at the read and derived write boundaries.

import { STRICT_PARSE_OPTIONS } from "@openchart/server/lib/resource/definition";
import { resourceIssues } from "@openchart/server/lib/resource/invariant";
import { deriveWriteShape } from "@openchart/server/lib/resource/write-schema";
import { Result, Schema } from "effect";
import { expect, test } from "vitest";

import { WatchlistColumn, WatchlistMetric } from "./column";
import { WatchlistEntity } from "./entity";
import { watchlistTable } from "./schema";

const read = Schema.decodeUnknownSync(WatchlistEntity, STRICT_PARSE_OPTIONS);
const write = Schema.decodeUnknownSync(
  deriveWriteShape(WatchlistEntity).schema,
  STRICT_PARSE_OPTIONS,
);
const envelope = { id: "wtl_test", revision: 1, createdAt: 0, updatedAt: 0 };
const boundaries = [
  (columns: unknown) => read({ ...envelope, name: "Markets", columns }),
  (columns: unknown) => write({ name: "Markets", columns }),
];

test("basic metric columns preserve their identity and authored order", () => {
  const columns = [
    { id: "wcl_volume", metric: { kind: "volume" } },
    { id: "wcl_price", metric: { kind: "price" } },
    { id: "wcl_percent", metric: { kind: "changePercent" } },
    { id: "wcl_change", metric: { kind: "change" } },
  ];
  for (const parse of boundaries) {
    expect(parse(columns).columns).toEqual(columns);
    expect(parse([...columns].reverse()).columns).toEqual(
      [...columns].reverse(),
    );
  }
  const entity = read({ ...envelope, name: "Markets", columns });
  expect(Schema.encodeSync(WatchlistEntity)(entity)).toEqual(entity);
});

test("omitted and empty columns use the watchlist table's empty default", () => {
  expect(read({ ...envelope, name: "Markets" }).columns).toEqual(
    watchlistTable.columns.default,
  );
  expect(write({ name: "Markets" }).columns).toEqual(
    watchlistTable.columns.default,
  );
  for (const parse of boundaries) expect(parse([]).columns).toEqual([]);
});

test("metrics require a supported discriminator and reject extra parameters", () => {
  const parse = Schema.decodeUnknownSync(WatchlistMetric);
  for (const kind of ["price", "change", "changePercent", "volume"]) {
    expect(parse({ kind })).toEqual({ kind });
    expect(() => parse({ kind, range: "1d" })).toThrow();
  }
  for (const metric of [
    "price",
    null,
    {},
    { kind: "pe" },
    { kind: "priceHistory" },
  ]) {
    expect(() => parse(metric)).toThrow();
  }
});

test("rejects unsupported metrics and obsolete column configuration", () => {
  const invalidColumns = [
    { id: "wcl_pe", metric: { kind: "pe" } },
    { id: "wcl_history", metric: { kind: "priceHistory" } },
    { id: "wcl_price", metric: "price" },
    { id: "wcl_price", metric: {} },
    { id: "wcl_price", metric: null },
    { id: "wcl_price", metric: { kind: "price", range: "1d" } },
    { id: "wcl_history", kind: "priceHistory", range: "1m", style: "line" },
    { id: "wcl_price", kind: "market", field: "price" },
    { id: "wcl_price", metric: { kind: "price" }, range: "1d" },
    { id: "wcl_price", metric: { kind: "price" }, style: "line" },
    { id: "wcl_price", metric: { kind: "price" }, value: 100 },
    { id: "wcl_price" },
    { id: "wit_wrong_prefix", metric: { kind: "price" } },
  ];
  for (const column of invalidColumns) {
    expect(() => Schema.decodeUnknownSync(WatchlistColumn)(column)).toThrow();
    for (const parse of boundaries) expect(() => parse([column])).toThrow();
  }
  for (const parse of boundaries) {
    expect(() => parse(null)).toThrow();
    expect(() =>
      parse({ id: "wcl_price", metric: { kind: "price" } }),
    ).toThrow();
  }
});

test("rejects duplicate column identities and metrics at both boundaries", () => {
  for (const columns of [
    [
      { id: "wcl_same", metric: { kind: "price" } },
      { id: "wcl_same", metric: { kind: "volume" } },
    ],
    [
      { id: "wcl_first", metric: { kind: "price" } },
      { id: "wcl_second", metric: { kind: "price" } },
    ],
  ]) {
    for (const parse of boundaries) expect(() => parse(columns)).toThrow();
  }
});

const listing = (symbol: string) => ({
  provider: "yfinance",
  listing: { symbol, currency: "USD" },
});

function issues(value: unknown) {
  const result = Schema.decodeUnknownResult(
    WatchlistEntity,
    STRICT_PARSE_OPTIONS,
  )({ ...envelope, name: "Markets", ...(value as object) });
  if (Result.isSuccess(result)) throw new Error("Expected a schema failure");
  return resourceIssues(result.failure.issue).map(({ code, path }) => ({
    code,
    path,
  }));
}

test("nested sections keep their order at any depth and require both arrays", () => {
  const sections = [
    {
      id: "wsc_root",
      name: "Markets",
      items: [{ id: "wit_aapl", ...listing("AAPL") }],
      sections: [
        {
          id: "wsc_child",
          items: [],
          sections: [{ id: "wsc_grandchild", items: [], sections: [] }],
        },
        {
          id: "wsc_second",
          items: [{ id: "wit_msft", ...listing("MSFT") }],
          sections: [],
        },
      ],
    },
    { id: "wsc_last", items: [], sections: [] },
  ];
  expect(read({ ...envelope, name: "Markets", sections }).sections).toEqual(
    sections,
  );
  expect(write({ name: "Markets", sections }).sections).toEqual(sections);
  for (const section of [
    { id: "wsc_rows", items: [] },
    { id: "wsc_children", sections: [] },
  ]) {
    expect(() =>
      read({ ...envelope, name: "Markets", sections: [section] }),
    ).toThrow();
    expect(() => write({ name: "Markets", sections: [section] })).toThrow();
  }
});

test("rejects the flat parent-pointer section shape", () => {
  const sections = [
    { id: "wsc_root", items: [], sections: [] },
    { id: "wsc_child", parentSectionId: "wsc_root", items: [], sections: [] },
  ];
  expect(() => read({ ...envelope, name: "Markets", sections })).toThrow();
  expect(() => write({ name: "Markets", sections })).toThrow();
});

test("ids and listings are unique across the whole tree", () => {
  expect(
    issues({
      sections: [
        {
          id: "wsc_root",
          items: [{ id: "wit_aapl", ...listing("AAPL") }],
          sections: [
            {
              id: "wsc_child",
              items: [],
              sections: [
                {
                  id: "wsc_root",
                  items: [
                    { id: "wit_aapl", ...listing("MSFT") },
                    { id: "wit_again", ...listing("AAPL") },
                  ],
                  sections: [],
                },
              ],
            },
          ],
        },
      ],
    }),
  ).toEqual([
    {
      code: "watchlist.unique_ids",
      path: "/sections/0/sections/0/sections/0/id",
    },
    {
      code: "watchlist.unique_ids",
      path: "/sections/0/sections/0/sections/0/items/0/id",
    },
    {
      code: "watchlist.unique_listing",
      path: "/sections/0/sections/0/sections/0/items/1/listing",
    },
  ]);
});
