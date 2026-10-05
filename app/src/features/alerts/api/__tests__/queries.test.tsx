// Purpose: Verify drawing reads and the single atomic save boundary.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import type { BarsSeries } from "@openchart/feed";
import {
  alertDrawingQueryOptions,
  alertEventExecutionsQueryOptions,
  encodedBarsInputs,
  useSaveAlertRule,
  useDuplicateAlertRule,
  useToggleAlertRule,
  type AlertConfig,
  type AlertRule,
  type AlertSave,
} from "@openchart/app/features/alerts/api/queries";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

const inputs = {
  provider: "test",
  listing: { symbol: "AAPL", currency: "USD" },
  resolution: "1m",
  session: "regular",
  adjustment: "raw",
} as BarsSeries;
// tRPC types stored configs with mutable arrays; fixtures hold the same JSON.
const stored = (config: AlertConfig) =>
  config as unknown as Extract<
    AlertRule["alertable"],
    { kind: "tea" }
  >["config"];
const rule: AlertRule = {
  id: "alr_one" as AlertRule["id"],
  revision: 7,
  createdAt: 1,
  updatedAt: 1,
  name: "Price",
  enabled: true,
  repeat: false,
  alertable: {
    kind: "tea",
    source: "source",
    config: stored({
      ...encodedBarsInputs(inputs),
      parameters: { threshold: 200 },
      requests: {},
    }),
  },
};
function setup() {
  const save = vi.fn().mockResolvedValue({ rule, actions: [] });
  const triggers = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  const patch = vi.fn();
  const transport = {
    url: "test",
    rpc: {
      resources: {
        macro: { saveAlertRule: { mutate: save } },
        drawing: { get: { query: vi.fn() } },
        trigger: { list: { query: triggers } },
        alert_rule: { patch: { mutate: patch } },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { transport, client, wrapper, save, triggers, patch };
}

test("event session queries batch the existing read endpoint and skip empty event sets", async () => {
  const query = vi.fn(async ({ eventIds }: { eventIds: string[] }) =>
    eventIds.map((eventId) => ({ eventId, runs: [] })),
  );
  const transport = {
    url: "test",
    rpc: { resources: { macro: { alertFeedExecutions: { query } } } },
  } as unknown as AppTransport;
  const client = new QueryClient();
  const ids = Array.from({ length: 201 }, (_, index) => `ale_event${index}`);
  expect(
    await client.fetchQuery(alertEventExecutionsQueryOptions(transport, ids)),
  ).toHaveLength(201);
  expect(query).toHaveBeenCalledTimes(2);
  expect(query).toHaveBeenNthCalledWith(
    1,
    { eventIds: ids.slice(0, 200) },
    expect.objectContaining({
      signal: expect.any(AbortSignal),
      context: { method: "POST" },
    }),
  );
  expect(query).toHaveBeenNthCalledWith(
    2,
    { eventIds: ids.slice(200) },
    expect.objectContaining({ context: { method: "POST" } }),
  );
  expect(
    await client.fetchQuery(alertEventExecutionsQueryOptions(transport, [])),
  ).toEqual([]);
  expect(query).toHaveBeenCalledTimes(2);
  client.clear();
});

test("missing drawing metadata is a deletion state; connection failures still propagate", async () => {
  const { transport, client } = setup();
  const query = vi.mocked(transport.rpc.resources.drawing.get.query);
  query.mockRejectedValueOnce(
    new TRPCClientError("Missing drawing", {
      result: {
        error: {
          code: -32004,
          message: "Missing drawing",
          data: { code: "NOT_FOUND", httpStatus: 404 },
        },
      },
    }),
  );
  await expect(
    client.fetchQuery(alertDrawingQueryOptions(transport, "drw_deleted")),
  ).resolves.toBeNull();
  query.mockRejectedValueOnce(new Error("Offline"));
  await expect(
    client.fetchQuery(alertDrawingQueryOptions(transport, "drw_offline")),
  ).rejects.toThrow("Offline");
  client.clear();
});

test("delivery-only edit submits one atomic snapshot, never a Rule patch", async () => {
  const { transport, wrapper, save, patch, client } = setup();
  const view = renderHook(() => useSaveAlertRule(transport), { wrapper });
  const value = {
    name: rule.name,
    enabled: rule.enabled,
    repeat: rule.repeat,
    alertable: rule.alertable,
  };
  const input = {
    rule: { id: rule.id, expectedRevision: 7 },
    value,
    actions: [
      {
        id: "trg_one",
        expectedRevision: 3,
        name: "Notify",
        enabled: true,
        target: { kind: "notification", message: "updated {symbol}" },
      },
    ],
  } as AlertSave;
  await act(() => view.result.current.mutateAsync(input));
  expect(save).toHaveBeenCalledExactlyOnceWith(input);
  expect(patch).not.toHaveBeenCalled();
  view.unmount();
  client.clear();
});

test("atomic conflicts are exposed without retrying or dropping the draft", async () => {
  const { transport, wrapper, save, client } = setup();
  save.mockRejectedValue(new Error("Conflict: reopen"));
  const view = renderHook(() => useSaveAlertRule(transport), { wrapper });
  const input = {
    value: {
      name: rule.name,
      enabled: true,
      repeat: false,
      alertable: rule.alertable,
    },
    actions: [],
  } as AlertSave;
  await act(async () => {
    await expect(view.result.current.mutateAsync(input)).rejects.toThrow(
      "Conflict",
    );
  });
  expect(save).toHaveBeenCalledTimes(1);
  view.unmount();
  client.clear();
});

test.each(["starter", "generated", "drawing"] as const)(
  "%s copy keeps full independent Agent parts, workspace and binding",
  async (kind) => {
    const { transport, wrapper, save, triggers, client } = setup();
    const target = {
      kind: "agent_prompt",
      prompt: {
        agent: "analyst",
        model: { providerID: "codex", modelID: "x" },
        workspaceId: "wsp_one",
        parts: [
          { type: "text", text: "custom {symbol}" },
          { type: "file", url: "file.png", mime: "image/png" },
        ],
      },
      binding: { id: "binding" },
    };
    triggers.mockResolvedValue({
      items: [
        {
          id: "trg_one",
          revision: 2,
          name: "Original action",
          enabled: false,
          event: { kind: "alert", ruleId: rule.id },
          target,
        },
      ],
      nextCursor: null,
    });
    const view = renderHook(() => useDuplicateAlertRule(transport), {
      wrapper,
    });
    // Starters hold the threshold in `threshold`; generated single conditions in c0_threshold.
    const parameter = kind === "starter" ? "threshold" : "c0_threshold";
    const original: AlertRule =
      kind === "starter"
        ? rule
        : kind === "generated"
          ? {
              ...rule,
              alertable: {
                kind: "tea",
                source: "generated",
                config: stored({
                  ...encodedBarsInputs(inputs),
                  parameters: { c0_op: "crossing", c0_threshold: 200 },
                  requests: {},
                }),
              },
            }
          : {
              ...rule,
              alertable: {
                kind: "drawing",
                drawingId: "drw_saved" as Extract<
                  AlertRule["alertable"],
                  { kind: "drawing" }
                >["drawingId"],
                operator: "crossing",
                inputs,
              },
            };
    await act(() =>
      view.result.current.mutateAsync({
        rule: original,
        threshold: { parameter, value: 205 },
      }),
    );
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      actions: [{ name: "Original action", enabled: false, target }],
    });
    // The new value replaces the saved one and adds no other key; drawings copy unchanged.
    const alertable = save.mock.calls[0]![0].value.alertable;
    if (kind === "drawing") expect(alertable).toEqual(original.alertable);
    else
      expect(alertable.config.parameters).toEqual(
        kind === "starter"
          ? { threshold: 205 }
          : { c0_op: "crossing", c0_threshold: 205 },
      );
    view.unmount();
    client.clear();
  },
);

test("enabling an invalid disabled draft validates through save and cannot patch around failure", async () => {
  const { transport, wrapper, save, patch, client } = setup();
  save.mockRejectedValue(new Error("Missing request binding"));
  const view = renderHook(() => useToggleAlertRule(transport), { wrapper });
  await act(async () => {
    await expect(
      view.result.current.mutateAsync({
        rule: { ...rule, enabled: false },
        enabled: true,
      }),
    ).rejects.toThrow("Missing request binding");
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(patch).not.toHaveBeenCalled();
  await act(() => view.result.current.mutateAsync({ rule, enabled: false }));
  expect(patch).toHaveBeenCalledExactlyOnceWith({
    id: rule.id,
    expectedRevision: rule.revision,
    operations: [{ op: "replace", path: "/enabled", value: false }],
  });
  view.unmount();
  client.clear();
});
