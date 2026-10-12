// Purpose: Queued edits must use the saved or refreshed revision across widget instances.
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";

import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  watchlistDetail,
  createWatchlist,
  formulaColumnMutation,
  watchlistMutation,
  type Watchlist,
} from "../api/queries";

test("a queued edit waits for conflict recovery before reading its revision", async () => {
  const original = {
    id: "wtl_test",
    revision: 1,
    name: "Markets",
    columns: [],
    sections: [],
  } as unknown as Watchlist;
  const current = { ...original, revision: 2, name: "Renamed elsewhere" };
  let refresh!: (watchlist: Watchlist) => void;
  const get = vi
    .fn()
    .mockResolvedValueOnce(original)
    .mockImplementationOnce(
      () =>
        new Promise<Watchlist>((resolve) => {
          refresh = resolve;
        }),
    );
  const patch = vi
    .fn()
    .mockRejectedValueOnce(new Error("Revision conflict"))
    .mockResolvedValueOnce({ ...current, revision: 3 });
  const transport = {
    rpc: {
      resources: {
        watchlist: { get: { query: get }, patch: { mutate: patch } },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await client.fetchQuery(watchlistDetail(transport, original.id));
  const first = new MutationObserver(
    client,
    watchlistMutation(transport, client, original.id),
  );
  const second = new MutationObserver(
    client,
    watchlistMutation(transport, client, original.id),
  );
  const rejected = first
    .mutate(() => [{ op: "replace", path: "/name", value: "First" }])
    .catch((error: unknown) => error);
  const queued = second.mutate((watchlist) => [
    { op: "replace", path: "/name", value: `${watchlist.name}!` },
  ]);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(patch).toHaveBeenCalledTimes(1);
  refresh(current);
  expect(await rejected).toEqual(new Error("Revision conflict"));
  await queued;
  expect(patch).toHaveBeenLastCalledWith({
    id: original.id,
    expectedRevision: 2,
    operations: [{ op: "replace", path: "/name", value: "Renamed elsewhere!" }],
  });
  client.clear();
});

test("copying a watchlist preserves complete formula settings with independent column identities", async () => {
  const columns = [
    {
      id: "wcl_old",
      visible: false,
      title: "Momentum",
      metric: {
        kind: "formula",
        source: { workspaceId: "wsp_test", path: "macd.tea" },
        snapshot: { "macd.tea": "code" },
        parameterOverrides: { fast: 8 },
        output: "histogram",
        bars: { resolution: "1d" },
      },
    },
  ] as unknown as Watchlist["columns"];
  const create = vi.fn().mockResolvedValue({});
  const transport = {
    rpc: { resources: { watchlist: { create: { mutate: create } } } },
  } as unknown as AppTransport;
  const client = new QueryClient();
  await new MutationObserver(client, createWatchlist(transport)).mutate({
    name: "Copy",
    columns,
  });
  expect(create).toHaveBeenCalledWith({
    name: "Copy",
    columns: [{ ...columns[0], id: expect.stringMatching(/^wcl_/) }],
  });
  expect(create.mock.calls[0]![0].columns[0].id).not.toBe(columns[0]!.id);
  client.clear();
});

test("formula edits reject unknown concurrent changes instead of silently adopting a newer revision", async () => {
  const configure = vi.fn().mockRejectedValue(new Error("Revision conflict"));
  const get = vi.fn().mockResolvedValue({
    id: "wtl_test",
    revision: 8,
    columns: [],
    sections: [],
  });
  const transport = {
    rpc: {
      resources: {
        watchlist: {
          configureFormulaColumn: { mutate: configure },
          get: { query: get },
        },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient();
  const settings = {
    output: "signal",
    parameterOverrides: {},
    bars: { resolution: "1d" as const },
  };
  await expect(
    new MutationObserver(
      client,
      formulaColumnMutation(transport, client, "wtl_test"),
    ).mutate({
      kind: "configure",
      columnId: "wcl_macd",
      expectedRevision: 7,
      settings,
    }),
  ).rejects.toThrow("This column changed");
  expect(configure).not.toHaveBeenCalled();
  client.clear();
});

test("formula settings rebase an unrelated revision only while the exact target is unchanged", async () => {
  const column = {
    id: "wcl_macd",
    visible: true,
    title: "MACD",
    metric: {
      kind: "formula",
      source: { workspaceId: "wsp_test", path: "macd.tea" },
      snapshot: { "macd.tea": "code" },
      parameterOverrides: {},
      output: "value",
      bars: { resolution: "1d" },
    },
  } as unknown as Watchlist["columns"][number];
  const latest = {
    id: "wtl_test",
    revision: 8,
    columns: [column],
    sections: [],
  } as unknown as Watchlist;
  const configure = vi.fn().mockResolvedValue({ ...latest, revision: 9 });
  const transport = {
    rpc: {
      resources: {
        watchlist: {
          get: { query: vi.fn().mockResolvedValue(latest) },
          configureFormulaColumn: { mutate: configure },
        },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient();
  const settings = {
    output: "signal",
    parameterOverrides: {},
    bars: { resolution: "1d" as const },
  };
  await new MutationObserver(
    client,
    formulaColumnMutation(transport, client, "wtl_test"),
  ).mutate({
    kind: "configure",
    columnId: column.id,
    expectedColumn: column,
    expectedRevision: 7,
    settings,
  });
  expect(configure).toHaveBeenCalledWith({
    id: "wtl_test",
    expectedRevision: 8,
    columnId: column.id,
    ...settings,
  });
  client.setQueryData<Watchlist>(
    watchlistDetail(transport, "wtl_test").queryKey,
    {
      ...latest,
      revision: 10,
      columns: [{ ...column, title: "Changed elsewhere" }],
    },
  );
  await expect(
    new MutationObserver(
      client,
      formulaColumnMutation(transport, client, "wtl_test"),
    ).mutate({
      kind: "configure",
      columnId: column.id,
      expectedColumn: column,
      expectedRevision: 7,
      settings,
    }),
  ).rejects.toThrow("This column changed");
  expect(configure).toHaveBeenCalledTimes(1);
  client.clear();
});
