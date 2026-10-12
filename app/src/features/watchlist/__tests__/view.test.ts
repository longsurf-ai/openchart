// Purpose: Preserve local preferences while migrating old metric sorting to stable column identities.
import { createWatchlistViewStore, migrateWatchlistSort } from "../stores/view";
import type { Watchlist } from "../api/queries";

beforeEach(() => localStorage.clear());

test.each(["price", "priceHistory"] as const)(
  "version 1 migrates %s after the saved list loads and retains selection and collapse",
  (metric) => {
    localStorage.setItem(
      "local:watchlist-widget:test",
      JSON.stringify({
        version: 1,
        state: {
          selectedWatchlistId: "wtl_test",
          collapsed: ["wsc_closed"],
          sort: { metric, direction: "desc" },
        },
      }),
    );
    const view = createWatchlistViewStore("test");
    expect(view.getState()).toEqual({
      selectedWatchlistId: "wtl_test",
      collapsed: ["wsc_closed"],
      sort: null,
      legacySort: { metric, direction: "desc" },
    });
    migrateWatchlistSort(view, {
      columns: [{ id: "wcl_price", metric: { kind: metric }, visible: true }],
    } as unknown as Watchlist);
    expect(view.getState()).toEqual({
      selectedWatchlistId: "wtl_test",
      collapsed: ["wsc_closed"],
      sort: { columnId: "wcl_price", direction: "desc" },
      legacySort: undefined,
    });
  },
);

test("a hidden or removed sort column restores saved order without resetting other preferences", () => {
  const view = createWatchlistViewStore("test");
  view.setState({
    selectedWatchlistId: "wtl_test",
    collapsed: ["wsc_closed"],
    sort: { columnId: "wcl_formula", direction: "asc" },
  });
  migrateWatchlistSort(view, {
    columns: [{ id: "wcl_formula", visible: false }],
  } as unknown as Watchlist);
  expect(view.getState()).toMatchObject({
    selectedWatchlistId: "wtl_test",
    collapsed: ["wsc_closed"],
    sort: null,
  });
});
