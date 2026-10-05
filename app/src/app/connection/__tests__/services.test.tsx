// Purpose: One connection supplies both Tea consumers and awaits shutdown before disconnecting.
// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Schema } from "apache-arrow";
import { EMPTY } from "rxjs";
import { beforeEach, expect, it, vi } from "vitest";
import { ProviderId } from "@openchart/market";
import * as Tea from "@openchart/tea";
import type { TeaClient } from "@openchart/app/lib/tea";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { TeaClientContext } from "@openchart/app/lib/tea/context";
import { useTea, type Node } from "@openchart/app/hooks/use-tea";
import { useBackendConnection } from "@openchart/app/app/connection/use-backend-connection";
const factories = vi.hoisted(() => ({ transport: vi.fn(), tea: vi.fn() }));
vi.mock("@openchart/app/lib/transport/transport", () => ({
  createTransport: factories.transport,
}));
vi.mock("@openchart/app/lib/tea", async (actual) => ({
  ...(await actual<typeof import("@openchart/app/lib/tea")>()),
  createTeaClient: factories.tea,
}));
const connection = { origin: "http://test" };
const configuration: Omit<Node, "source"> = {
  parameters: {},
  ...Tea.barsInputs({
    provider: ProviderId.make("test"),
    listing: { symbol: "AAA", currency: "USD" },
    resolution: "1d",
    session: "regular",
    adjustment: "raw",
  }),
  requests: {},
  from: 0,
  to: "now",
  countBack: 1,
  warmupBars: Tea.standardWarmupBars,
};
const node: Tea.CompileResponse = {
  id: "node",
  declaration: null,
  definition: {
    parameters: [],
    inputs: new Schema([]),
    outputs: new Schema([]),
    requests: {},
  },
};
beforeEach(() => vi.resetAllMocks());
it("shares across consumers, preserves the client on consumer removal and drains each retired connection", async () => {
  const records: {
    client: TeaClient;
    disconnect: ReturnType<typeof vi.fn>;
    finish: () => void;
  }[] = [];
  factories.transport.mockImplementation(() => ({
    events: EMPTY,
    hose: { disconnect: vi.fn() },
  }));
  factories.tea.mockImplementation((transport: AppTransport) => {
    let finish!: () => void;
    const shutdown = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const client: TeaClient = {
      url: connection.origin,
      compile: vi.fn(async (request) => ({
        ...node,
        id: "entry" in request ? request.entry : request.path,
      })),
      snapshot: vi.fn(),
      observe: vi.fn(() => EMPTY),
      dispose: vi.fn(async () => {}),
      close: vi.fn(() => shutdown),
    };
    records.push({
      client,
      disconnect: transport.hose.disconnect as ReturnType<typeof vi.fn>,
      finish,
    });
    return client;
  });
  function Consumer({ id }: { id: string }) {
    useTea({ ...configuration, source: { entry: id, sources: { [id]: "x" } } });
    return null;
  }
  function Owner({ second }: { second: boolean }) {
    const { services, reconnect } = useBackendConnection(connection);
    return (
      <>
        <button onClick={reconnect}>Reconnect</button>
        {services ? (
          <TeaClientContext.Provider value={services.tea}>
            <Consumer id="ind_one" />
            {second ? <Consumer id="ind_two" /> : null}
          </TeaClientContext.Provider>
        ) : null}
      </>
    );
  }
  const queryClient = new QueryClient();
  const wrap = (second: boolean) => (
    <QueryClientProvider client={queryClient}>
      <Owner second={second} />
    </QueryClientProvider>
  );
  const view = render(wrap(true));
  await waitFor(() =>
    expect(records[0]?.client.compile).toHaveBeenCalledTimes(2),
  );
  expect(factories.tea).toHaveBeenCalledOnce();
  view.rerender(wrap(false));
  await waitFor(() =>
    expect(records[0]!.client.dispose).toHaveBeenCalledWith({ id: "ind_two" }),
  );
  expect(records[0]!.client.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  await waitFor(() => expect(records).toHaveLength(2));
  expect(records[0]!.client.close).toHaveBeenCalledOnce();
  expect(records[0]!.disconnect).not.toHaveBeenCalled();
  await act(async () => {
    records[0]!.finish();
  });
  expect(records[0]!.disconnect).toHaveBeenCalledOnce();
  expect(records[1]!.client.close).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(records[1]!.client.compile).toHaveBeenCalledOnce(),
  );
  view.unmount();
  expect(records[1]!.client.close).toHaveBeenCalledOnce();
  expect(records[1]!.disconnect).not.toHaveBeenCalled();
  await act(async () => {
    records[1]!.finish();
  });
  expect(records[1]!.disconnect).toHaveBeenCalledOnce();
  queryClient.clear();
});
