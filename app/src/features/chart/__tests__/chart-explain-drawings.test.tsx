import { renderWithToaster as render } from "@openchart/app/testing/test-utils";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
import { findErrorToast } from "@openchart/app/testing/test-utils";
// Purpose: Exercise Chart Explain at the ordinary cell Drawing entry point with the shared Agent provider and bound-session hook.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { v2 } from "@openchart/chart-core";
import { defineId } from "@openchart/identifier";
import { ProviderId } from "@openchart/market";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { Subject } from "rxjs";
import { expect, it, vi } from "vitest";

import {
  chartDetail,
  createCell,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import { DrawingSource } from "@openchart/app/features/chart/components/sources/drawings";
import { ChartContext } from "@openchart/app/lib/chart/context";
import {
  drawingList,
  type DrawingResource,
} from "@openchart/app/lib/chart/drawings";
import { ChartGridContext } from "@openchart/app/lib/chart/grid";
import {
  createChartStore,
  type ChartOutput,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";
import { AgentProvider } from "@openchart/app/lib/agent/provider";
import type { Agent } from "@openchart/app/lib/agent/use-agent";
import type { SessionSnapshot } from "@openchart/app/lib/agent/session-store";
import type { SessionState } from "@openchart/app/lib/agent/client";
import type { SessionProgress } from "@openchart/app/lib/agent/session-progress";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

function setup() {
  const market = {
    provider: ProviderId.make("test"),
    listing: { symbol: "AAPL", currency: "USD" },
  };
  const cell = createCell(market, {
    resolution: "5m",
    session: "extended",
    adjustment: "split",
  });
  const resource: ChartResource = {
    id: defineId("cht", "Chart.ID").create(),
    dashboardId: defineId("dsh", "Dashboard.ID").create(),
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    cells: [cell],
    links: [],
    preset: "1",
  };
  let rows: DrawingResource[] = [];
  const create = vi.fn(
    async (
      body: Omit<
        DrawingResource,
        "id" | "revision" | "createdAt" | "updatedAt"
      >,
    ) => {
      const row = {
        ...body,
        id: defineId("drw", "Drawing.ID").create(),
        revision: 1,
        createdAt: 0,
        updatedAt: 0,
      };
      rows.push(row);
      return row;
    },
  );
  const patch = vi.fn(async ({ id }: { id: string }) =>
    rows.find((row) => row.id === id)!,
  );
  const remove = vi.fn(async ({ id }: { id: string }) => {
    rows = rows.filter((row) => row.id !== id);
  });
  const list = vi.fn(async () => ({ items: [...rows], nextCursor: null }));
  const readBinding = vi.fn(async () => ({ id: "ses_test" }));
  const transport = {
    url: "http://chart-explain.test",
    rpc: {
      agent: { getSessionByBinding: { query: readBinding } },
      resources: {
        chart: { get: { query: async () => resource } },
        drawing: {
          list: { query: list },
          create: { mutate: create },
          patch: { mutate: patch },
          delete: { mutate: remove },
        },
      },
    },
  } as unknown as AppTransport;
  const client = createQueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(chartDetail(transport, resource.id).queryKey, resource);
  const output = new Subject<ChartOutput>();
  const store = createChartStore(v2.createState({ id: cell.id }));
  const chart: ChartRuntime = {
    id: cell.id,
    store,
    output$: output,
    renderer: {
      setSeriesPrimitives: vi.fn(),
      primitiveAt: vi.fn(() => null),
      id: cell.id,
      canvas: document.createElement("canvas"),
      render: vi.fn(),
      beginAnnotationDrag: vi.fn(),
      seriesValueAtY: vi.fn(),
      seriesYAtValue: vi.fn(),
      drawingLabelPlacement: vi.fn(),
      scheduleResize: vi.fn(),
      setSuspended: vi.fn(),
      dispose: vi.fn(),
    },
    mutate: (recipe) => store.setState(recipe, true),
  };
  let session: SessionSnapshot = {
    messages: [],
    subagents: {},
    state: undefined,
    history: { hasMore: false, loading: false, error: undefined },
    loading: false,
    error: undefined,
  };
  const listeners = new Set<() => void>();
  const handle = {
    id: "ses_test",
    loadOlder: vi.fn(),
    getSnapshot: () => session,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    submit: vi.fn(),
    rename: vi.fn(),
    cancel: vi.fn(),
    replyQuestion: vi.fn(),
    replyPermission: vi.fn(),
    dispose: vi.fn(),
  } satisfies ReturnType<Agent["getSession"]>;
  const bind = vi.fn(async () => ({ id: "ses_test" }));
  const submit = vi.fn(async () => undefined);
  const agent = {
    getSession: () => handle,
    defaultModel: { providerID: "codex", modelID: "tier1" },
    getOrCreateBoundSession: { mutateAsync: bind },
    submitPrompt: { mutateAsync: submit },
  } as unknown as Agent;
  const tree = (
    <StrictMode>
      <QueryClientProvider client={client}>
        <AgentProvider agent={agent}>
          <ChartGridContext.Provider
            value={{
              chartId: resource.id,
              transport,
              focusedId: cell.id,
              setFocused: vi.fn(),
              maximizedId: undefined,
              toggleMaximized: vi.fn(),
              mounted: new Map(),
              register: () => () => {},
            }}
          >
            <ChartContext.Provider value={chart}>
              <DrawingSource cellId={cell.id} />
            </ChartContext.Provider>
          </ChartGridContext.Provider>
        </AgentProvider>
      </QueryClientProvider>
    </StrictMode>
  );
  const gesture = () =>
    act(() => {
      chart.mutate((state) => {
        state.chartExplain!.draftBand = {
          xStart: 0,
          xEnd: 100,
          color: "#123456",
          translucent: true,
          mode: "annotating",
          startedAtMs: 10,
        };
      });
      output.next({
        type: "chart-explain",
        id: cell.id,
        color: "#123456",
        selection: { fromIndex: 0, toIndex: 1, fromTs: 1000, toTs: 2000 },
      });
    });
  const publish = (progress: SessionProgress | undefined) =>
    act(() => {
      session = {
        ...session,
        messages: progress
          ? [
              {
                id: "msg_test",
                role: "assistant",
                content: progress.lines.join("\n"),
              },
            ]
          : [],
        state: {
          session: {
            id: "ses_test" as SessionState["session"]["id"],
            title: "Test",
            kind: "chart_explain",
            bindingId: "asb_test",
            parentId: null,
            anchors: null,
            compactingAt: null,
            archivedAt: null,
            lastReadRunId: null,
            createdAt: 0,
            updatedAt: 0,
          },
          messageInfo: {},
          history: { nextCursor: null },
          questions: [],
          permissions: [],
          runs: progress
            ? [
                {
                  id: "agr_test" as SessionState["runs"][number]["id"],
                  sessionID: "ses_test",
                  sessionIntentID: "intent",
                  status: progress.status,
                  createdAt: progress.startedAt,
                  startedAt:
                    progress.status === "queued" ? null : progress.startedAt,
                  finishedAt: null,
                  queuePosition: null,
                },
              ]
            : [],
        },
      };
      listeners.forEach((listener) => listener());
    });
  return {
    tree,
    resource,
    cell,
    transport,
    client,
    chart,
    create,
    patch,
    remove,
    list,
    bind,
    submit,
    readBinding,
    listeners,
    agent,
    gesture,
    publish,
    rows: () => rows,
  };
}

it("starts only from a gesture, projects progress into an ordinary Drawing, and restores without resubmitting", async () => {
  const test = setup();
  let view = render(test.tree);
  await waitFor(() => expect(test.list).toHaveBeenCalled());
  expect(test.create).not.toHaveBeenCalled();
  expect(test.bind).not.toHaveBeenCalled();
  expect(test.submit).not.toHaveBeenCalled();
  test.gesture();
  await waitFor(() => expect(test.submit).toHaveBeenCalledTimes(1));
  const drawing = test.rows()[0]!;
  expect(test.create).toHaveBeenCalledExactlyOnceWith({
    dashboardId: test.resource.dashboardId,
    provider: test.cell.marketSources[0]!.provider,
    listing: test.cell.marketSources[0]!.listing,
    data: drawing.data,
  });
  expect(drawing.data).toMatchObject({
    type: "agent_session",
    anchors: [],
    range: { from: 1_000_000, to: 2_000_000 },
    style: { lineColor: "#123456" },
  });
  expect(test.bind).toHaveBeenCalledExactlyOnceWith({
    key: `drawing:${drawing.id}`,
    title: "Explain AAPL selection",
    kind: "chart_explain",
  });
  expect(test.submit).toHaveBeenCalledExactlyOnceWith({
    sessionID: "ses_test",
    model: { providerID: "codex", modelID: "tier1" },
    parts: [
      {
        type: "plugin_input",
        input: {
          type: "chart_explain",
          drawingId: drawing.id,
          resolution: "5m",
          session: "extended",
          adjustment: "split",
        },
      },
    ],
  });
  await waitFor(() =>
    expect(
      v2.ChartStateModel.drawingItems(test.chart.store.getState()),
    ).toEqual([drawing.data]),
  );
  expect(test.chart.store.getState().chartExplain?.draftBand).toBeUndefined();
  await waitFor(() => expect(test.listeners.size).toBeGreaterThan(0));

  const progress = {
    status: "running" as const,
    startedAt: performance.timeOrigin + 25,
    lines: Array.from({ length: 8 }, (_, i) => `Line ${i}`),
  };
  test.publish(progress);
  expect(
    test.chart.store.getState().drawings.sessionProgress?.[drawing.data.id],
  ).toEqual({
    startedAtMs: 25,
    progressLog: progress.lines.slice(-3).map((text) => ({ text, atMs: 25 })),
  });
  expect(drawing.data).not.toHaveProperty("sessionProgress");
  expect(test.patch).not.toHaveBeenCalled();
  view.unmount();
  expect(test.listeners.size).toBe(0);
  expect(
    test.chart.store.getState().drawings.sessionProgress?.[drawing.data.id],
  ).toBeUndefined();
  view = render(test.tree);
  await waitFor(() =>
    expect(
      test.chart.store.getState().drawings.sessionProgress?.[drawing.data.id],
    ).toBeDefined(),
  );
  expect(test.readBinding).toHaveBeenCalledWith(
    { key: `drawing:${drawing.id}` },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(test.bind).toHaveBeenCalledTimes(1);
  expect(test.submit).toHaveBeenCalledTimes(1);

  test.publish(undefined);
  expect(
    test.chart.store.getState().drawings.sessionProgress?.[drawing.data.id],
  ).toBeUndefined();
  expect(
    v2.ChartStateModel.drawingItems(test.chart.store.getState()),
  ).toHaveLength(1);
  act(() =>
    test.chart.mutate((state) =>
      v2.ChartStateModel.removeDrawingObject(state, drawing.data.id),
    ),
  );
  fireEvent.mouseUp(window);
  await waitFor(() =>
    expect(test.remove).toHaveBeenCalledExactlyOnceWith({ id: drawing.id }),
  );
  await waitFor(() => expect(test.listeners.size).toBe(0));
  view.unmount();
  test.client.clear();
});

it("retries the same drawing and releases its progress when the cell changes listing", async () => {
  const test = setup();
  test.bind.mockRejectedValueOnce(new Error("Binding offline"));
  const view = render(test.tree);
  test.gesture();
  expect(await findErrorToast("Binding offline")).toHaveTextContent(
    "Binding offline",
  );
  expect(test.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(test.submit).toHaveBeenCalledTimes(1));
  expect(test.create).toHaveBeenCalledTimes(1);
  const drawing = test.rows()[0]!;
  await waitFor(() => expect(test.listeners.size).toBeGreaterThan(0));
  test.publish({
    status: "queued",
    startedAt: performance.timeOrigin + 30,
    lines: [],
  });
  expect(
    test.chart.store.getState().drawings.sessionProgress?.[drawing.data.id]
      ?.progressLog[0]?.text,
  ).toBe("Queued…");
  act(() => {
    test.client.setQueryData(
      chartDetail(test.transport, test.resource.id).queryKey,
      {
        ...test.resource,
        cells: [
          {
            ...test.cell,
            marketSources: test.cell.marketSources.map((source) => ({
              ...source,
              listing: { ...source.listing, symbol: "MSFT" },
            })),
          },
        ],
      },
    );
  });
  await waitFor(() => expect(test.listeners.size).toBe(0));
  expect(
    test.chart.store.getState().drawings.sessionProgress?.[drawing.data.id],
  ).toBeUndefined();
  expect(
    v2.ChartStateModel.drawingItems(test.chart.store.getState()),
  ).toHaveLength(0);
  expect(test.submit).toHaveBeenCalledTimes(1);
  expect(test.rows()[0]!.listing.symbol).toBe("AAPL");
  expect(
    test.client.getQueryData(
      drawingList(test.transport, { ...test.rows()[0]! }).queryKey,
    ),
  ).toHaveLength(1);
  view.unmount();
  test.client.clear();
});

it("preserves bar settings on retry and reads current settings for the next gesture", async () => {
  const test = setup();
  test.bind.mockRejectedValueOnce(new Error("Binding offline"));
  const view = render(test.tree);
  test.gesture();
  expect(await findErrorToast("Binding offline")).toHaveTextContent(
    "Binding offline",
  );

  await act(async () => {
    test.client.setQueryData(
      chartDetail(test.transport, test.resource.id).queryKey,
      {
        ...test.resource,
        cells: [
          {
            ...test.cell,
            resolution: "1h",
            session: "regular",
            adjustment: "split_dividend",
          },
        ],
      },
    );
  });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(test.submit).toHaveBeenCalledTimes(1));
  expect(test.submit).toHaveBeenLastCalledWith(
    expect.objectContaining({
      parts: [
        {
          type: "plugin_input",
          input: {
            type: "chart_explain",
            drawingId: test.rows()[0]!.id,
            resolution: "5m",
            session: "extended",
            adjustment: "split",
          },
        },
      ],
    }),
  );

  test.gesture();
  await waitFor(() => expect(test.submit).toHaveBeenCalledTimes(2));
  expect(test.submit).toHaveBeenLastCalledWith(
    expect.objectContaining({
      parts: [
        {
          type: "plugin_input",
          input: {
            type: "chart_explain",
            drawingId: test.rows()[1]!.id,
            resolution: "1h",
            session: "regular",
            adjustment: "split_dividend",
          },
        },
      ],
    }),
  );
  view.unmount();
  test.client.clear();
});

it("submits a completed gesture even when its cell immediately unmounts", async () => {
  const test = setup();
  const view = render(test.tree);
  act(() => {
    test.gesture();
    view.unmount();
  });
  await waitFor(() => expect(test.submit).toHaveBeenCalledTimes(1));
  expect(test.bind).toHaveBeenCalledTimes(1);
  expect(test.create).toHaveBeenCalledTimes(1);
  expect(test.listeners.size).toBe(0);
  expect(test.chart.store.getState().chartExplain?.draftBand).toBeUndefined();
  test.client.clear();
});
