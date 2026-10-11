// Purpose: Prove tree indexing and that each drop becomes one RFC 6902 move landing where the tree showed it.
import fastJsonPatch from "fast-json-patch";
import type { ProviderListing } from "@openchart/market";

import type { Watchlist, WatchlistOperation } from "../api/queries";
import {
  addListing,
  addSection,
  indexWatchlist,
  moveColumn,
  moveOperation,
  removeNode,
  renameSection,
  ROOT_ID,
  toggleColumn,
} from "../utils/tree";

const listing = (symbol: string) =>
  ({
    provider: "yfinance",
    listing: { symbol, currency: "USD" },
  }) as ProviderListing;
const row = (id: string, symbol: string) => ({ id, ...listing(symbol) });

const watchlist = {
  columns: [],
  sections: [
    {
      id: "wsc_tech",
      name: "Tech",
      items: [row("wit_aapl", "AAPL"), row("wit_msft", "MSFT")],
      sections: [
        {
          id: "wsc_chips",
          name: "Chips",
          items: [row("wit_nvda", "NVDA")],
          sections: [],
        },
      ],
    },
    {
      id: "wsc_plain",
      items: [row("wit_xom", "XOM")],
      sections: [],
    },
  ],
} as unknown as Watchlist;

function apply(document: unknown, operation: WatchlistOperation): unknown {
  return fastJsonPatch.applyOperation(document, operation, true, false)
    .newDocument;
}

const childrenOf = (value: unknown, id: string) =>
  indexWatchlist(value as Watchlist).get(id)?.children;

test("indexes rows before child sections and indents only under named sections", () => {
  const nodes = indexWatchlist(watchlist);
  expect(nodes.get(ROOT_ID)?.children).toEqual(["wsc_tech", "wsc_plain"]);
  expect(nodes.get("wsc_tech")?.children).toEqual([
    "wit_aapl",
    "wit_msft",
    "wsc_chips",
  ]);
  expect(nodes.get("wit_nvda")).toMatchObject({
    path: "/sections/0/sections/0/items/0",
    depth: 2,
  });
  expect(nodes.get("wit_xom")).toMatchObject({ depth: 0 });
});

test.each([
  // Reorder rows within a section; the index counts rows after the move.
  [
    "wit_aapl",
    "wsc_tech",
    1,
    "wsc_tech",
    ["wit_msft", "wit_aapl", "wsc_chips"],
  ],
  // A row moves into a nested section and to the end of another section.
  ["wit_msft", "wsc_chips", 0, "wsc_chips", ["wit_msft", "wit_nvda"]],
  ["wit_aapl", "wsc_plain", undefined, "wsc_plain", ["wit_xom", "wit_aapl"]],
  // A section moves after its rows, out to the root, and before a sibling whose index shifts.
  ["wsc_chips", ROOT_ID, 2, ROOT_ID, ["wsc_tech", "wsc_plain", "wsc_chips"]],
  ["wsc_tech", "wsc_plain", 1, "wsc_plain", ["wit_xom", "wsc_tech"]],
  ["wsc_plain", ROOT_ID, 0, ROOT_ID, ["wsc_plain", "wsc_tech"]],
] as const)(
  "moves %s into %s at %s",
  (id, parentId, index, check, expected) => {
    const operation = moveOperation(watchlist, id, parentId, index);
    expect(operation).toMatchObject({ op: "move" });
    expect(childrenOf(apply(watchlist, operation!), check)).toEqual(expected);
  },
);

test.each([
  ["a negative index", "wit_aapl", "wsc_tech", -1],
  ["a fractional index", "wit_aapl", "wsc_tech", 0.5],
  ["a row at the root", "wit_aapl", ROOT_ID, 0],
  ["a row among child sections", "wit_xom", "wsc_tech", 3],
  ["a section among rows", "wsc_chips", "wsc_plain", 0],
  ["a section into itself", "wsc_tech", "wsc_tech", 3],
  ["a section into its descendant", "wsc_tech", "wsc_chips", 1],
  ["a node into a row", "wit_aapl", "wit_msft", 0],
] as const)("rejects %s", (_, id, parentId, index) => {
  expect(moveOperation(watchlist, id, parentId, index)).toBeNull();
});

test("a drop in place is valid but moves nowhere", () => {
  // Headless Tree asks whether a row may join its parent before offering reorder slots.
  expect(moveOperation(watchlist, "wit_msft", "wsc_tech")).toEqual({
    op: "move",
    from: "/sections/0/items/1",
    path: "/sections/0/items/1",
  });
});

test("adds listings to the chosen, first, or a new unnamed section", () => {
  expect(addListing(watchlist, listing("AMD"), "wsc_chips")).toEqual([
    {
      op: "add",
      path: "/sections/0/sections/0/items/-",
      value: expect.objectContaining({ id: expect.stringMatching(/^wit_/) }),
    },
  ]);
  expect(addListing(watchlist, listing("AMD"))[0]).toMatchObject({
    path: "/sections/0/items/-",
  });
  expect(addListing({ sections: [] }, listing("AMD"))).toEqual([
    {
      op: "add",
      path: "/sections/-",
      value: {
        id: expect.stringMatching(/^wsc_/),
        items: [
          expect.objectContaining({
            listing: { symbol: "AMD", currency: "USD" },
          }),
        ],
        sections: [],
      },
    },
  ]);
  expect(() => addListing(watchlist, listing("NVDA"))).toThrow(
    "already in this watchlist",
  );
  expect(() => addListing(watchlist, listing("AMD"), "wsc_deleted")).toThrow(
    "no longer exists",
  );
});

test("edits sections and columns by path", () => {
  expect(addSection(watchlist, "Energy", "wsc_tech")[0]).toMatchObject({
    path: "/sections/0/sections/-",
    value: { name: "Energy", items: [], sections: [] },
  });
  expect(renameSection(watchlist, "wsc_plain", " Energy ")).toEqual([
    { op: "add", path: "/sections/1/name", value: "Energy" },
  ]);
  expect(renameSection(watchlist, "wsc_tech", "")).toEqual([
    { op: "remove", path: "/sections/0/name" },
  ]);
  expect(renameSection(watchlist, "wsc_plain", "")).toEqual([]);
  expect(removeNode(watchlist, "wit_nvda")).toEqual([
    { op: "remove", path: "/sections/0/sections/0/items/0" },
  ]);
  const columns = {
    columns: [{ id: "wcl_price", metric: { kind: "price" } }],
  } as unknown as Watchlist;
  expect(toggleColumn(columns, "price")).toEqual([
    { op: "remove", path: "/columns/0" },
  ]);
  expect(toggleColumn(columns, "volume")[0]).toMatchObject({
    op: "add",
    path: "/columns/-",
    value: { metric: { kind: "volume" } },
  });
});

test("column drops resolve ids after earlier reorders and ignore removed targets", () => {
  const columns = {
    columns: ["volume", "price", "change"].map((kind) => ({
      id: `wcl_${kind}`,
      metric: { kind },
    })),
  } as unknown as Watchlist;
  const [operation] = moveColumn(columns, "wcl_change", "wcl_volume");
  expect(
    (apply(columns, operation!) as Watchlist).columns.map(
      (column) => column.id,
    ),
  ).toEqual(["wcl_change", "wcl_volume", "wcl_price"]);
  expect(moveColumn(columns, "wcl_price", "wcl_price")).toEqual([]);
  expect(moveColumn(columns, "wcl_removed", "wcl_price")).toEqual([]);
  expect(moveColumn(columns, "wcl_price", "wcl_removed")).toEqual([]);
});
