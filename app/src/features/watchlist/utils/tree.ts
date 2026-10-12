// Purpose: Map a Watchlist's nested sections to tree nodes and to the JSON Patch operations that edit them.
import { defineId } from "@openchart/identifier";
import { providerListingKey, type ProviderListing } from "@openchart/market";
import fastJsonPatch from "fast-json-patch";

import type { Watchlist, WatchlistOperation } from "../api/queries";

type Section = Watchlist["sections"][number];
type Item = Section["items"][number];

/** A metric a column can show; the Resource owns the list. */
export type Metric = Watchlist["columns"][number]["metric"]["kind"];

/** Every metric in display-menu order. */
export const METRICS = [
  "price",
  "change",
  "changePercent",
  "volume",
  "priceHistory",
] as const satisfies readonly Metric[];

/** Client-generated child identities, matching the Resource's prefixes. */
export const watchlistIds = {
  column: defineId("wcl", "WatchlistColumn.ID"),
  section: defineId("wsc", "WatchlistSection.ID"),
  item: defineId("wit", "WatchlistItem.ID"),
};

/** The tree's invisible root; its children are the top-level sections. */
export const ROOT_ID = "root";

/** Whether the tree has a visible heading or row; empty unnamed containers render nothing. */
export function hasVisibleRows(sections: readonly Section[]): boolean {
  return sections.some(
    (section) =>
      section.name !== undefined ||
      section.items.length > 0 ||
      hasVisibleRows(section.sections),
  );
}

/**
 * One node of the rendered tree. A section's children are its rows followed by
 * its child sections, matching the entity's two arrays. `path` is the node's
 * JSON Pointer in the Watchlist. `depth` counts named ancestors only, because
 * an unnamed section shows no heading and indents nothing.
 */
export type WatchlistNode =
  | { kind: "root"; id: string; path: ""; children: string[] }
  | {
      kind: "section";
      id: string;
      path: string;
      parentId: string;
      depth: number;
      section: Section;
      children: string[];
    }
  | {
      kind: "item";
      id: string;
      path: string;
      parentId: string;
      depth: number;
      item: Item;
      children: string[];
    };

/** Index every node by id. @example indexWatchlist(watchlist).get(ROOT_ID)?.children */
export function indexWatchlist(
  watchlist: Pick<Watchlist, "sections">,
): Map<string, WatchlistNode> {
  const nodes = new Map<string, WatchlistNode>();
  const visit = (
    sections: readonly Section[],
    parentId: string,
    parentPath: string,
    depth: number,
  ): string[] =>
    sections.map((section, s) => {
      const path = `${parentPath}/sections/${s}`;
      const inner = section.name === undefined ? depth : depth + 1;
      const rows = section.items.map((item, i) => {
        nodes.set(item.id, {
          kind: "item",
          id: item.id,
          path: `${path}/items/${i}`,
          parentId: section.id,
          depth: inner,
          item,
          children: [],
        });
        return item.id;
      });
      nodes.set(section.id, {
        kind: "section",
        id: section.id,
        path,
        parentId,
        depth,
        section,
        children: [
          ...rows,
          ...visit(section.sections, section.id, path, inner),
        ],
      });
      return section.id;
    });
  nodes.set(ROOT_ID, {
    kind: "root",
    id: ROOT_ID,
    path: "",
    children: visit(watchlist.sections, ROOT_ID, "", 0),
  });
  return nodes;
}

/**
 * The one RFC 6902 `move` that places node `id` among `parentId`'s children,
 * as Headless Tree reports a drop: `index` counts children after the node has
 * left, which is also how `move` resolves its target path. Rows go only among
 * a section's rows and sections only after them; an omitted index appends.
 * Null means the drop is invalid, such as into the node's own subtree. A
 * valid drop that changes nothing returns a move whose `from` equals `path`;
 * callers skip saving it.
 * @example moveOperation(watchlist, "wit_a", "wsc_b", 0)
 */
export function moveOperation(
  watchlist: Pick<Watchlist, "sections">,
  id: string,
  parentId: string,
  index?: number,
): Extract<WatchlistOperation, { op: "move" }> | null {
  const node = indexWatchlist(watchlist).get(id);
  if (!node || node.kind === "root") return null;
  if (index !== undefined && (!Number.isInteger(index) || index < 0))
    return null;
  // Paths after removal; a parent inside the moved subtree no longer exists.
  const removed = fastJsonPatch.applyOperation(
    watchlist,
    { op: "remove", path: node.path },
    true,
    false,
  ).newDocument;
  const parent = indexWatchlist(removed).get(parentId);
  if (!parent || parent.kind === "item") return null;
  const rows = parent.kind === "section" ? parent.section.items.length : 0;
  let path: string;
  if (node.kind === "item") {
    const position = index ?? rows;
    if (parent.kind !== "section" || position > rows) return null;
    path = `${parent.path}/items/${position}`;
  } else {
    const position = (index ?? parent.children.length) - rows;
    if (position < 0 || position > parent.children.length - rows) return null;
    path = `${parent.path}/sections/${position}`;
  }
  return { op: "move", from: node.path, path };
}

/** Append a listing to a section, or to the first section, creating an unnamed one when there is none. Reject duplicate listings or a deleted explicit target. */
export function addListing(
  watchlist: Pick<Watchlist, "sections">,
  listing: ProviderListing,
  sectionId?: string,
): WatchlistOperation[] {
  const item = {
    id: watchlistIds.item.create(),
    provider: listing.provider,
    listing: listing.listing,
  };
  const nodes = indexWatchlist(watchlist);
  const key = providerListingKey(listing);
  if (
    [...nodes.values()].some(
      (node) => node.kind === "item" && providerListingKey(node.item) === key,
    )
  )
    throw new Error(`${listing.listing.symbol} is already in this watchlist.`);
  const target = nodes.get(
    sectionId ?? nodes.get(ROOT_ID)?.children[0] ?? ROOT_ID,
  );
  if (sectionId && target?.kind !== "section")
    throw new Error("This section no longer exists.");
  if (target?.kind === "section")
    return [{ op: "add", path: `${target.path}/items/-`, value: item }];
  return [
    {
      op: "add",
      path: "/sections/-",
      value: { id: watchlistIds.section.create(), items: [item], sections: [] },
    },
  ];
}

/** Add an empty named section at the top level or inside another section. */
export function addSection(
  watchlist: Pick<Watchlist, "sections">,
  name: string,
  parentId: string = ROOT_ID,
): WatchlistOperation[] {
  const parent = indexWatchlist(watchlist).get(parentId);
  if (!parent || parent.kind === "item") return [];
  return [
    {
      op: "add",
      path: `${parent.path}/sections/-`,
      value: {
        id: watchlistIds.section.create(),
        name,
        items: [],
        sections: [],
      },
    },
  ];
}

/** Rename a section; a blank name removes its heading. */
export function renameSection(
  watchlist: Pick<Watchlist, "sections">,
  id: string,
  name: string,
): WatchlistOperation[] {
  const node = indexWatchlist(watchlist).get(id);
  if (node?.kind !== "section") return [];
  const value = name.trim();
  if (value) return [{ op: "add", path: `${node.path}/name`, value }];
  return node.section.name === undefined
    ? []
    : [{ op: "remove", path: `${node.path}/name` }];
}

/** Remove a row, or a section with its rows and child sections. */
export function removeNode(
  watchlist: Pick<Watchlist, "sections">,
  id: string,
): WatchlistOperation[] {
  const node = indexWatchlist(watchlist).get(id);
  return node && node.kind !== "root"
    ? [{ op: "remove", path: node.path }]
    : [];
}

/** Show or hide one metric column. */
export function toggleColumn(
  watchlist: Pick<Watchlist, "columns">,
  metric: Metric,
): WatchlistOperation[] {
  const index = watchlist.columns.findIndex(
    (column) => column.metric.kind === metric,
  );
  if (index >= 0) return [{ op: "remove", path: `/columns/${index}` }];
  return [
    {
      op: "add",
      path: "/columns/-",
      value: { id: watchlistIds.column.create(), metric: { kind: metric } },
    },
  ];
}

/** Resolve both column ids against the latest revision; a removed column makes the drop a no-op. */
export function moveColumn(
  watchlist: Pick<Watchlist, "columns">,
  fromId: string,
  toId: string,
): WatchlistOperation[] {
  const from = watchlist.columns.findIndex((column) => column.id === fromId);
  const to = watchlist.columns.findIndex((column) => column.id === toId);
  return from < 0 || to < 0 || from === to
    ? []
    : [{ op: "move", from: `/columns/${from}`, path: `/columns/${to}` }];
}
