// Purpose: Exercise drawing saves, shared projections, failed edits and scope changes through Query.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Drawing, v2 } from "@openchart/chart-core";
import { defineId } from "@openchart/identifier";
import { ProviderId } from "@openchart/market";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, useState } from "react";
import { EMPTY } from "rxjs";
import { expect, it, vi } from "vitest";

import { useDrawingResources } from "@openchart/app/hooks/use-drawing-resources";
import {
  drawingList,
  drawingMutation,
  drawingScopeKey,
  type DrawingResource,
  type DrawingScope,
} from "@openchart/app/lib/chart/drawings";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

function runtime(id: string): ChartRuntime {
  const store = createChartStore(v2.createState({ id }));
  return {
    id,
    store,
    output$: EMPTY,
    renderer: {
      setSeriesPrimitives: vi.fn(),
      primitiveAt: vi.fn(() => null),
      id,
      canvas: document.createElement("canvas"),
      render: vi.fn(),
      seriesValueAtY: vi.fn(),
      seriesYAtValue: vi.fn(),
      drawingLabelPlacement: vi.fn(),
      beginAnnotationDrag: vi.fn(),
      scheduleResize: vi.fn(),
      setSuspended: vi.fn(),
      dispose: vi.fn(),
    },
    mutate: (recipe) => store.setState(recipe, true),
  };
}
const items = (chart: ChartRuntime) =>
  v2.ChartStateModel.drawingItems(chart.store.getState());

it.each(["trend_line", "annotation"] as const)(
  "shares %s saves, retries failed edits and flushes to the original listing when switching",
  async (type) => {
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
    const patch = vi.fn(
      async ({
        id,
        expectedRevision,
        operations,
      }: {
        id: string;
        expectedRevision: number;
        operations: [{ value: Drawing.Item }];
      }) => {
        const index = rows.findIndex((row) => row.id === id);
        const row = rows[index]!;
        if (row.revision !== expectedRevision)
          throw new Error("Revision conflict");
        const saved = {
          ...row,
          revision: row.revision + 1,
          data: operations[0].value,
        };
        rows[index] = saved;
        return saved;
      },
    );
    const remove = vi.fn(async ({ id }: { id: string }) => {
      rows = rows.filter((row) => row.id !== id);
    });
    const transport = {
      url: "http://drawings.test",
      rpc: {
        resources: {
          drawing: {
            list: {
              query: vi.fn(async () => ({
                items: [...rows],
                nextCursor: null,
              })),
            },
            create: { mutate: create },
            patch: { mutate: patch },
            delete: { mutate: remove },
          },
        },
      },
    } as unknown as AppTransport;
    const scope: DrawingScope = {
      dashboardId: "dsh_test",
      provider: ProviderId.make("test"),
      listing: { id: 10244, symbol: "SPCX", currency: "USD" },
    };
    const first = runtime("first"),
      second = runtime("second");
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    function Projection({
      chart,
      scope,
    }: {
      chart: ChartRuntime;
      scope: DrawingScope;
    }) {
      const drawings = useDrawingResources(chart, transport, scope);
      const [savedId, setSavedId] = useState("");
      return (
        <>
          <button
            onClick={() => {
              const item = items(chart)[0];
              if (item)
                void drawings
                  .ensureSaved(item.id)
                  .then((saved) => setSavedId(saved.id));
            }}
          >
            Save {chart.id}
          </button>
          <output aria-label={`Saved ${chart.id}`}>{savedId}</output>
          {drawings.error ? (
            <button onClick={() => void drawings.retry()}>
              Retry {chart.id}
            </button>
          ) : null}
        </>
      );
    }
    const tree = (selected = scope) => (
      <StrictMode>
        <QueryClientProvider client={client}>
          <Projection
            key={drawingScopeKey(selected)}
            chart={first}
            scope={selected}
          />
          <Projection chart={second} scope={scope} />
        </QueryClientProvider>
      </StrictMode>
    );
    const view = render(tree());
    const drawing =
      type === "annotation"
        ? Drawing.create("annotation", [], {
            time: 1,
            title: "Explanation",
            body: "Body",
            sources: [],
            sentiment: 0,
          })
        : Drawing.create("trend_line", [
            { time: 1, price: 1 },
            { time: 2, price: 2 },
          ]);
    act(() =>
      first.mutate((state) =>
        v2.ChartStateModel.upsertDrawingObject(state, drawing),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save first" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(items(second)).toHaveLength(1));
    expect(items(second)[0]!.id).toBe(drawing.id);
    await waitFor(() =>
      expect(screen.getByLabelText("Saved first")).toHaveTextContent(
        rows[0]!.id,
      ),
    );
    expect(rows[0]!.id).not.toBe(drawing.id);

    patch.mockRejectedValueOnce(new Error("Offline"));
    act(() =>
      first.mutate((state) => {
        const item = v2.ChartStateModel.drawingItems(state)[0]!;
        item.style.lineWidth = 3;
        if (item.type === "annotation")
          item.labelAnchor = { time: 10, price: 120 };
      }),
    );
    fireEvent.mouseUp(window);
    await screen.findByRole("button", { name: "Retry first" });
    expect(items(first)[0]!).toMatchObject({ style: { lineWidth: 3 } });
    expect(rows[0]!.data).toMatchObject({ style: { lineWidth: 1 } });
    fireEvent.click(screen.getByRole("button", { name: "Retry first" }));
    await waitFor(() =>
      expect(rows[0]!.data).toMatchObject({ style: { lineWidth: 3 } }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Retry first" }),
      ).not.toBeInTheDocument(),
    );

    act(() =>
      first.mutate((state) => {
        v2.ChartStateModel.drawingItems(state)[0]!.style.lineWidth = 5;
      }),
    );
    view.rerender(tree({ ...scope, listing: { ...scope.listing, id: 55090 } }));
    await waitFor(() =>
      expect(rows[0]!.data).toMatchObject({ style: { lineWidth: 5 } }),
    );
    expect(rows[0]!.listing.id).toBe(10244);
    await waitFor(() => expect(items(first)).toHaveLength(0));
    await waitFor(() =>
      expect(items(second)[0]!).toMatchObject({ style: { lineWidth: 5 } }),
    );
    view.rerender(tree());
    await waitFor(() =>
      expect(items(first)[0]!).toMatchObject({ style: { lineWidth: 5 } }),
    );
    act(() =>
      second.mutate((state) =>
        v2.ChartStateModel.removeDrawingObject(state, drawing.id),
      ),
    );
    fireEvent.mouseUp(window);
    await waitFor(() => expect(rows).toHaveLength(0));
    await waitFor(() => expect(items(first)).toHaveLength(0));
    expect(create).toHaveBeenCalledTimes(1);
    if (type === "annotation")
      expect(patch.mock.calls.at(-1)?.[0].operations[0].value).toMatchObject({
        time: 1,
        anchors: [],
        labelAnchor: { time: 10, price: 120 },
      });
    view.unmount();
    client.clear();
  },
);

it.each(["extended_line", "parallel_channel"] as const)(
  "edits only the linked %s without creating or deleting drawings",
  async (type) => {
    const scope: DrawingScope = {
      dashboardId: "dsh_linked",
      provider: ProviderId.make("test"),
      listing: { symbol: "BTCUSDT", currency: "USDT" },
    };
    const resource = (data: Drawing.Item): DrawingResource => ({
      ...scope,
      id: defineId("drw", "Drawing.ID").create(),
      revision: 1,
      createdAt: 0,
      updatedAt: 0,
      data,
    });
    const target = resource(
      Drawing.create(type, [
        { time: 1, price: 1 },
        { time: 2, price: 2 },
        ...(type === "parallel_channel" ? [{ time: 2, price: 3 }] : []),
      ]),
    );
    // Another drawing of the same kind must not become editable in this view.
    const other = resource(Drawing.create(type, target.data.anchors));
    target.data.hidden = true;
    let rows = [target, other];
    const create = vi.fn();
    const remove = vi.fn();
    const patch = vi.fn(
      async ({
        id,
        operations,
      }: {
        id: string;
        operations: [{ value: Drawing.Item }];
      }) => {
        const current = rows.find((row) => row.id === id)!;
        const saved = {
          ...current,
          revision: current.revision + 1,
          data: operations[0].value,
        };
        rows = rows.map((row) => (row.id === id ? saved : row));
        return saved;
      },
    );
    const transport = {
      url: "http://linked-drawing.test",
      rpc: {
        resources: {
          drawing: {
            list: {
              query: vi.fn(async () => ({ items: rows, nextCursor: null })),
            },
            create: { mutate: create },
            patch: { mutate: patch },
            delete: { mutate: remove },
          },
        },
      },
    } as unknown as AppTransport;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const chart = runtime("inline"),
      dashboard = runtime("dashboard");
    function Projection({
      chart,
      drawingId,
    }: {
      chart: ChartRuntime;
      drawingId?: string;
    }) {
      const drawings = useDrawingResources(chart, transport, scope, drawingId);
      return drawings.error ? (
        <button onClick={() => void drawings.retry()}>Retry {chart.id}</button>
      ) : null;
    }
    const view = render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <Projection chart={chart} drawingId={target.id} />
          <Projection chart={dashboard} />
        </QueryClientProvider>
      </StrictMode>,
    );
    await waitFor(() =>
      expect(items(chart).map((item) => item.id)).toEqual([target.data.id]),
    );
    await waitFor(() => expect(items(dashboard)).toHaveLength(2));
    expect(items(chart)[0]!.hidden).toBe(false);
    expect(
      items(dashboard).find((item) => item.id === target.data.id)!.hidden,
    ).toBe(true);
    expect(patch).not.toHaveBeenCalled();

    patch.mockRejectedValueOnce(new Error("Offline"));
    act(() =>
      chart.mutate((state) => {
        v2.ChartStateModel.drawingItems(state)[0]!.anchors[0]!.price = 10;
      }),
    );
    fireEvent.mouseUp(window);
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry inline" }),
    );
    await waitFor(() => expect(rows[0]!.data.anchors[0]!.price).toBe(10));
    await waitFor(() =>
      expect(
        items(dashboard).find((item) => item.id === target.data.id)?.anchors[0]!
          .price,
      ).toBe(10),
    );
    expect(rows[1]).toBe(other);

    // Pending edits from the full chart cannot leak unrelated drawings into this projection.
    act(() =>
      dashboard.mutate((state) => {
        v2.ChartStateModel.drawingItems(state).find(
          (item) => item.id === other.data.id,
        )!.anchors[0]!.price = 20;
      }),
    );
    fireEvent.mouseUp(window);
    await waitFor(() => expect(rows[1]!.data.anchors[0]!.price).toBe(20));
    expect(items(chart).map((item) => item.id)).toEqual([target.data.id]);

    // Restrictions travel with the queued edit, including when another view retries it.
    const mutation = drawingMutation(transport, client, scope);
    const update = { id: target.data.id, existingResourceId: target.id };
    for (const edit of [
      update,
      { ...update, data: { ...target.data, type: "horizontal_line" as const } },
      { ...update, id: other.data.id, data: other.data },
    ]) {
      await expect(
        mutation.mutationFn!(edit, undefined as never),
      ).rejects.toThrow("only update the linked drawing");
    }

    act(() =>
      chart.mutate((state) => {
        v2.ChartStateModel.drawingItems(state)[0]!.anchors[0]!.price = 30;
      }),
    );
    view.unmount();
    await waitFor(() => expect(rows[0]!.data.anchors[0]!.price).toBe(30));
    expect(rows[0]!.data.type).toBe(type);
    expect(rows[0]!.data.hidden).toBe(true);
    rows = [rows[1]!];
    client.setQueryData(drawingList(transport, scope).queryKey, rows);
    await expect(
      mutation.mutationFn!(
        { ...update, data: target.data },
        undefined as never,
      ),
    ).rejects.toThrow("only update the linked drawing");
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    client.clear();
  },
);

it("read-only views lock every drawing and never save changes", async () => {
  const scope: DrawingScope = {
    dashboardId: "dsh_feed",
    provider: ProviderId.make("test"),
    listing: { symbol: "BTCUSDT", currency: "USDT" },
  };
  const row: DrawingResource = {
    ...scope,
    id: defineId("drw", "Drawing.ID").create(),
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    data: Drawing.create("trend_line", [
      { time: 1, price: 1 },
      { time: 2, price: 2 },
    ]),
  };
  const create = vi.fn();
  const patch = vi.fn();
  const remove = vi.fn();
  const transport = {
    url: "http://read-only-drawing.test",
    rpc: {
      resources: {
        drawing: {
          list: {
            query: vi.fn(async () => ({ items: [row], nextCursor: null })),
          },
          create: { mutate: create },
          patch: { mutate: patch },
          delete: { mutate: remove },
        },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const chart = runtime("feed");
  function Projection() {
    useDrawingResources(chart, transport, scope, undefined, true);
    return null;
  }
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <Projection />
      </QueryClientProvider>
    </StrictMode>,
  );
  await waitFor(() => expect(items(chart)).toHaveLength(1));
  expect(items(chart)[0]!.locked).toBe(true);
  expect(row.data.locked).toBe(false);

  act(() =>
    chart.mutate((state) => {
      v2.ChartStateModel.drawingItems(state)[0]!.anchors[0]!.price = 10;
    }),
  );
  fireEvent.mouseUp(window);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(patch).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();

  view.unmount();
  expect(items(chart)).toHaveLength(0);
  expect(patch).not.toHaveBeenCalled();
  client.clear();
});
