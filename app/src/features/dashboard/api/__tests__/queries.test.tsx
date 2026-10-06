// Purpose: Verify Dashboard absence, deletion and late-read cache coordination.
import { defineId } from "@openchart/identifier";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { expect, test, vi } from "vitest";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  dashboardQueryOptions,
  deleteDashboardMutationOptions,
  type Dashboard,
} from "../queries";

function setup() {
  const get = vi.fn();
  const remove = vi.fn().mockResolvedValue(undefined);
  const transport = {
    url: "test",
    rpc: {
      resources: {
        dashboard: { get: { query: get }, delete: { mutate: remove } },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () => useMutation(deleteDashboardMutationOptions(transport, client)),
    { wrapper },
  );
  return {
    get,
    remove,
    client,
    view,
    options: dashboardQueryOptions(transport, "dsh_test"),
  };
}

test("a late detail response cannot restore a successfully deleted Dashboard", async () => {
  const { get, client, view, options } = setup();
  const dashboard: Dashboard = {
    id: defineId("dsh", "Dashboard.ID").make("dsh_test"),
    name: "Overview",
    widgets: [],
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    favorite: false,
  };
  client.setQueryData(options.queryKey, dashboard);
  let finishRead!: (value: Dashboard) => void;
  get.mockImplementation(
    () =>
      new Promise<Dashboard>((resolve) => {
        finishRead = resolve;
      }),
  );
  const read = client.fetchQuery(options).catch(() => undefined);
  await act(() => view.result.current.mutateAsync("dsh_test"));
  expect(client.getQueryData(options.queryKey)).toBeNull();
  finishRead(dashboard);
  await read;
  expect(client.getQueryData(options.queryKey)).toBeNull();
  view.unmount();
  client.clear();
});

test("missing reads and already-absent deletes are normal outcomes; other failures remain errors", async () => {
  const { get, remove, client, view, options } = setup();
  const missing = Object.assign(new Error("Dashboard not found"), {
    data: { code: "NOT_FOUND" },
  });
  get.mockRejectedValue(missing);
  expect(await client.fetchQuery(options)).toBeNull();
  remove.mockRejectedValue(missing);
  await act(() => view.result.current.mutateAsync("dsh_test"));
  expect(view.result.current.isError).toBe(false);
  const offline = Object.assign(new Error("Offline"), {
    data: { code: "INTERNAL_SERVER_ERROR" },
  });
  get.mockRejectedValue(offline);
  await expect(client.fetchQuery(options)).rejects.toBe(offline);
  remove.mockRejectedValue(offline);
  await act(async () => {
    await expect(view.result.current.mutateAsync("dsh_test")).rejects.toBe(
      offline,
    );
  });
  view.unmount();
  client.clear();
});
