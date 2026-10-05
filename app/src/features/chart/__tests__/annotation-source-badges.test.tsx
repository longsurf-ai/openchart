// Purpose: Loading derived icons must repaint without changing persistent drawing objects.
// @vitest-environment jsdom
import { Drawing, v2 } from "@openchart/chart-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { EMPTY } from "rxjs";
import { afterEach, expect, it, vi } from "vitest";

import { AnnotationSourceBadges } from "@openchart/app/features/chart/components/annotation-source-badges";
import { ChartContext } from "@openchart/app/lib/chart/context";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

afterEach(() => vi.unstubAllGlobals());

it("shares icons by hostname, preserves drawing references and ignores completion after unmount", async () => {
  const images: Array<{ onload?: () => void }> = [];
  vi.stubGlobal(
    "Image",
    class {
      constructor() {
        images.push(this);
      }
      onload?: () => void;
    },
  );
  const state = v2.createState({ id: "chart" });
  const item = Drawing.create("annotation", [], {
    time: 1000,
    title: "Earnings",
    body: "Revenue rose.",
    sentiment: 0.5,
    sources: [
      { title: "Report", url: "https://example.com/report" },
      { title: "Statement", url: "https://example.com/statement" },
      { title: "Other", url: "https://other.com/news" },
      { title: "Unavailable", url: "https://missing.com/news" },
    ],
  });
  v2.ChartStateModel.upsertDrawingObject(state, item);
  const store = createChartStore(state);
  const originalObjects = store.getState().objects;
  const chart: ChartRuntime = {
    id: state.id,
    store,
    output$: EMPTY,
    renderer: { render: vi.fn() } as unknown as v2.ChartRenderer,
    mutate: (recipe) => store.setState(recipe, true),
  };
  const logo = "data:image/png;base64,source-badges-test";
  const otherLogo = "data:image/png;base64,pending-source-badge-test";
  const query = vi.fn(async ({ hostname }: { hostname: string }) =>
    hostname === "example.com"
      ? logo
      : hostname === "other.com"
        ? otherLogo
        : null,
  );
  const transport = {
    rpc: { favicon: { get: { query } } },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ChartContext.Provider value={chart}>
        <AnnotationSourceBadges transport={transport} />
      </ChartContext.Provider>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      store.getState().sourceBadgesByAnnotationId?.[item.id]?.[0]?.logoUrl,
    ).toBe(logo),
  );
  expect(query).toHaveBeenCalledTimes(3);
  expect(
    store
      .getState()
      .sourceBadgesByAnnotationId?.[item.id]?.map((badge) => badge.logoUrl),
  ).toEqual([logo, logo, otherLogo, undefined]);
  expect(store.getState().objects).toBe(originalObjects);
  expect(images).toHaveLength(2);
  act(() => images[1]?.onload?.());
  expect(chart.renderer.render).toHaveBeenCalledWith("light");
  expect(store.getState().objects).toBe(originalObjects);
  view.unmount();
  expect(
    store.getState().sourceBadgesByAnnotationId?.[item.id],
  ).toBeUndefined();
  vi.mocked(chart.renderer.render).mockClear();
  act(() => images[0]?.onload?.());
  expect(chart.renderer.render).not.toHaveBeenCalled();
  client.clear();
});
