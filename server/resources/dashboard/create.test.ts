// Purpose: Dashboard creation must work before any market-data provider is configured.
import { router } from "@openchart/server";
import { Feed } from "@openchart/server/feed/service";
import { makeRuntime } from "@openchart/server/runtime";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { ConfigProvider } from "effect";
import { expect, test, vi } from "vitest";

test("creates an empty dashboard without consulting Feed or creating a Chart", async () => {
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
    models: { fetchEnabled: false, userAgent: "dashboard-create-test" },
  });
  try {
    const feed = await runtime.runPromise(Feed.use((service) => service.get()));
    const search = vi.spyOn(feed.symbology, "search");
    const capabilities = vi.spyOn(feed.bars, "getCapabilities");
    const caller = router.createCaller({ runtime });
    const dashboard = await caller.resources.dashboard.create({
      name: "Tea workspace",
      widgets: [],
    });
    expect(dashboard).toMatchObject({
      name: "Tea workspace",
      revision: 1,
      widgets: [],
    });
    expect(search).not.toHaveBeenCalled();
    expect(capabilities).not.toHaveBeenCalled();
    expect(await caller.resources.chart.list()).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(await caller.resources.dashboard.get({ id: dashboard.id })).toEqual(
      dashboard,
    );
  } finally {
    vi.restoreAllMocks();
    await runtime.dispose();
  }
});
