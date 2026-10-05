// Purpose: Exercise history pagination, read failures and expansion without editing saved events.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { AlertEvents } from "../alert-events";
import { chartSettings } from "@openchart/app/stores/chart";
import { agentQueryKeys } from "@openchart/app/lib/agent/queries";

const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});
const event = (
  id: string,
  time: number,
  data: Record<string, unknown> = {},
) => ({
  id,
  ruleId: "alr_test",
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
  time,
  condition: "alert",
  detail: { title: `Event ${id}`, message: "Condition matched", data },
});
function mount(
  query: ReturnType<typeof vi.fn>,
  sessions = vi.fn().mockResolvedValue([]),
  onOpenSession = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const transport = {
    url: "test",
    rpc: {
      resources: {
        alert_event: { history: { query } },
        macro: { alertFeedExecutions: { query: sessions } },
      },
    },
  } as unknown as AppTransport;
  render(
    <QueryClientProvider client={client}>
      <AlertEvents
        transport={transport}
        ruleId="alr_test"
        onOpenSession={onOpenSession}
      />
    </QueryClientProvider>,
  );
  return client;
}

test("uses the full count, preserves first page after pagination failure and retries the same cursor", async () => {
  const first = event("one", new Date(2026, 9, 5, 9).getTime(), {
    symbol: "SAVED",
    value: 0,
    parameters: { threshold: 58 },
  });
  const second = event("two", new Date(2026, 9, 4, 9).getTime());
  const query = vi
    .fn()
    .mockResolvedValueOnce({ items: [first], total: 2, nextCursor: "next" })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ items: [second], total: 2, nextCursor: null });
  mount(query);
  expect(await screen.findByText("2 events total")).toBeInTheDocument();
  expect(screen.getByText("SAVED · 0")).toBeInTheDocument();
  const firstRow = screen.getByRole("button", { name: /Event one/ });
  expect(firstRow).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(firstRow);
  expect(firstRow).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Condition matched")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Show more events" }),
  );
  expect(await screen.findByText("Try again")).toBeInTheDocument();
  expect(screen.getByText("Event one")).toBeInTheDocument();
  expect(screen.queryByText("No events yet")).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Show more events" }),
  );
  expect(await screen.findByText("Event two")).toBeInTheDocument();
  expect(query.mock.calls[1]?.[0]).toEqual({
    ruleId: "alr_test",
    order: "desc",
    limit: 50,
    cursor: "next",
  });
  expect(query.mock.calls[2]?.[0]).toEqual(query.mock.calls[1]?.[0]);
  expect(
    screen.queryByRole("button", { name: "Show more events" }),
  ).not.toBeInTheDocument();
});

test("sort starts a new bounded query and resource invalidation refreshes saved events", async () => {
  const query = vi.fn().mockResolvedValue({
    items: [event("first", 0)],
    total: 1,
    nextCursor: null,
  });
  const client = mount(query);
  await screen.findByText("1 event");
  await userEvent.click(screen.getByRole("button", { name: "Event order" }));
  await userEvent.click(
    screen.getByRole("menuitemradio", { name: "Oldest first" }),
  );
  await waitFor(() =>
    expect(query).toHaveBeenCalledWith(
      { ruleId: "alr_test", order: "asc", limit: 50, cursor: undefined },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  );
  query.mockResolvedValue({
    items: [event("new", 1)],
    total: 1,
    nextCursor: null,
  });
  await client.invalidateQueries({ queryKey: [["resources", "alert_event"]] });
  expect(await screen.findByText("Event new")).toBeInTheDocument();
  expect(
    within(screen.getByRole("button", { name: /Event new/ })).queryByText(
      "Value",
    ),
  ).not.toBeInTheDocument();
});

test("failed initial reads offer retry without claiming an empty history", async () => {
  const query = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ items: [], total: 0, nextCursor: null });
  mount(query);
  await screen.findByRole("button", { name: "Retry loading events" });
  expect(screen.queryByText("No events yet")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Time zone:/ }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Retry loading events" }),
  );
  expect(await screen.findByText("No events yet")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Time zone:/ }),
  ).not.toBeInTheDocument();
});

test("the shared timezone menu changes times and date groups without refetching or changing chart preferences", async () => {
  const chartTimezone = chartSettings.getState().timezone;
  const query = vi.fn().mockResolvedValue({
    items: [
      event("later", Date.parse("2026-10-05T07:30:00Z")),
      event("earlier", Date.parse("2026-10-05T06:30:00Z")),
    ],
    total: 2,
    nextCursor: null,
  });
  mount(query);
  await screen.findByText("2 events total");
  await userEvent.click(
    screen.getByRole("button", { name: "Time zone: Local" }),
  );
  await userEvent.click(screen.getByRole("menuitemradio", { name: "UTC" }));
  expect(screen.getAllByText("06:30:00").length).toBeGreaterThan(0);
  expect(
    within(screen.getByRole("region", { name: /Oct 5, 2026/ })).getAllByRole(
      "button",
      { name: /Event/ },
    ),
  ).toHaveLength(2);
  expect(
    screen.queryByRole("region", { name: /Oct 4, 2026/ }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Time zone: UTC" }));
  await userEvent.click(
    screen.getByRole("menuitemradio", { name: "Los Angeles" }),
  );
  expect(screen.getAllByText("23:30:00").length).toBeGreaterThan(0);
  expect(
    within(screen.getByRole("region", { name: /Oct 4, 2026/ })).getByRole(
      "button",
      { name: /Event earlier/ },
    ),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: /Oct 5, 2026/ })).getByRole(
      "button",
      { name: /Event later/ },
    ),
  ).toBeInTheDocument();
  expect(query).toHaveBeenCalledTimes(1);
  expect(chartSettings.getState().timezone).toBe(chartTimezone);
});

test("session links belong to their event, deduplicate shared sessions and only request navigation", async () => {
  const query = vi.fn().mockResolvedValue({
    items: [event("one", 2), event("two", 1)],
    total: 2,
    nextCursor: null,
  });
  const sessions = vi.fn().mockResolvedValue([
    {
      eventId: "one",
      runs: [
        { sessionId: "ses_shared", title: "Review BTC breakout" },
        { sessionId: "ses_shared", title: "Review BTC breakout" },
        { sessionId: "ses_other", title: "Check risk and key levels" },
      ],
    },
    { eventId: "two", runs: [] },
  ]);
  const open = vi.fn();
  mount(query, sessions, open);
  const link = await screen.findByRole("button", {
    name: "Review BTC breakout",
  });
  expect(
    screen.getAllByRole("button", { name: "Review BTC breakout" }),
  ).toHaveLength(1);
  expect(screen.getAllByRole("list", { name: "Linked sessions" })).toHaveLength(
    1,
  );
  expect(
    screen.getByRole("button", { name: "Details for Event one" }),
  ).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(link);
  expect(open).toHaveBeenCalledExactlyOnceWith("ses_shared");
  expect(
    screen.getByRole("button", { name: "Details for Event one" }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(sessions).toHaveBeenCalledWith(
    { eventIds: ["one", "two"] },
    expect.objectContaining({ context: { method: "POST" } }),
  );
});

test("Agent directory invalidation reveals sessions accepted after the event's initial read", async () => {
  const query = vi.fn().mockResolvedValue({
    items: [event("one", 1)],
    total: 1,
    nextCursor: null,
  });
  const sessions = vi.fn().mockResolvedValue([{ eventId: "one", runs: [] }]);
  const client = mount(query, sessions);
  await screen.findByText("1 event");
  await waitFor(() => expect(sessions).toHaveBeenCalledTimes(1));
  expect(
    screen.queryByRole("list", { name: "Linked sessions" }),
  ).not.toBeInTheDocument();
  sessions.mockResolvedValue([
    {
      eventId: "one",
      runs: [{ sessionId: "ses_late", title: "Accepted later" }],
    },
  ]);
  await client.invalidateQueries({ queryKey: agentQueryKeys.sessions("test") });
  expect(
    await screen.findByRole("button", { name: "Accepted later" }),
  ).toBeInTheDocument();
});

test("session read failures keep event facts and offer a read-only retry", async () => {
  const query = vi.fn().mockResolvedValue({
    items: [event("one", 1)],
    total: 1,
    nextCursor: null,
  });
  const sessions = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([
      {
        eventId: "one",
        runs: [{ sessionId: "ses_one", title: "Existing chat" }],
      },
    ]);
  mount(query, sessions);
  await screen.findByRole("button", { name: "Retry loading sessions" });
  expect(screen.getByText("Event one")).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Retry loading sessions" }),
  );
  expect(
    await screen.findByRole("button", { name: "Existing chat" }),
  ).toBeInTheDocument();
});
