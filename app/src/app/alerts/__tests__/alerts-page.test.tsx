// Purpose: Changing alert tabs preserves the unsaved editor while keeping its footer out of history.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { AlertsPage } from "../alerts-page";
const openSession = vi.hoisted(() => vi.fn());
vi.mock("@openchart/app/app/agent/copilot-controls", () => ({
  useCopilotControls: () => ({ selectSession: openSession }),
}));

vi.mock("@openchart/app/app/section-page", () => ({
  SectionPage: ({
    children,
    contentHeading,
    footer,
  }: {
    children: ReactNode;
    contentHeading: ReactNode;
    footer: ReactNode;
  }) => (
    <div>
      {contentHeading}
      {children}
      {footer}
    </div>
  ),
}));
vi.mock("@openchart/app/features/alerts/api/monitoring", () => ({
  useAlertHealth: () => () => ({ state: "paused" }),
}));
vi.mock("../alert-rule-actions", () => ({
  AlertRuleActions: () => null,
  AlertRulePauseButton: () => null,
}));
vi.mock("../new-alert-menu", () => ({ NewAlertMenu: () => null }));
vi.mock("../alert-listing-picker", () => ({
  renderAlertListingPicker: () => null,
}));
vi.mock("../alert-prompt-editor", () => ({ alertPromptEditor: () => null }));
vi.mock("@openchart/app/features/alerts/components/alert-rule-dialog", () => ({
  AlertRulePage: ({
    renderTitle,
    renderFooter,
    onDirtyChange,
  }: {
    renderTitle: (value: ReactNode) => ReactNode;
    renderFooter: (value: ReactNode) => ReactNode;
    onDirtyChange: (value: boolean) => void;
  }) => {
    const [draft, setDraft] = useState("Saved message");
    return (
      <>
        {renderTitle("Rule title")}
        <label>
          Message
          <input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              onDirtyChange(true);
            }}
          />
        </label>
        {renderFooter(<button type="button">Save rule</button>)}
      </>
    );
  },
}));
const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.clear()));
function mount(path: string, withSession = false) {
  const query = vi.fn().mockResolvedValue({
    items: withSession
      ? [
          {
            id: "ale_one",
            ruleId: "alr_test",
            time: 0,
            condition: "alert",
            detail: { title: "Price alert", message: "", data: {} },
          },
        ]
      : [],
    total: withSession ? 1 : 0,
    nextCursor: null,
  });
  const transport = {
    url: "test",
    rpc: {
      resources: {
        alert_rule: {
          get: {
            query: vi
              .fn()
              .mockResolvedValue({ id: "alr_test", name: "Rule title" }),
          },
        },
        alert_event: { history: { query } },
        macro: {
          alertFeedExecutions: {
            query: vi.fn().mockResolvedValue([
              {
                eventId: "ale_one",
                runs: [{ sessionId: "ses_existing", title: "Review alert" }],
              },
            ]),
          },
        },
      },
    },
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Outlet context={{ transport }} />}>
            <Route path="/app/alerts/rules/:ruleId" element={<AlertsPage />} />
            <Route path="/app/alerts/new" element={<AlertsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return query;
}

test("Events keeps the unsaved Setting draft mounted and hides Save until returning", async () => {
  const history = mount("/app/alerts/rules/alr_test");
  const message = await screen.findByRole("textbox", { name: "Message" });
  await userEvent.clear(message);
  await userEvent.type(message, "Unsaved message");
  await userEvent.click(screen.getByRole("tab", { name: "Events" }));
  expect(await screen.findByText("No events yet")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save rule" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("textbox", { name: "Message" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Setting" }));
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Unsaved message",
  );
  expect(screen.getByRole("button", { name: "Save rule" })).toBeVisible();
  expect(history).toHaveBeenCalledTimes(1);
});

test("unsaved new rules cannot open Events", async () => {
  const history = mount("/app/alerts/new");
  expect(await screen.findByRole("tab", { name: "Events" })).toBeDisabled();
  expect(history).not.toHaveBeenCalled();
});

test("opening a linked session selects the existing Copilot conversation and retains the Setting draft", async () => {
  openSession.mockClear();
  mount("/app/alerts/rules/alr_test", true);
  const message = await screen.findByRole("textbox", { name: "Message" });
  await userEvent.clear(message);
  await userEvent.type(message, "Keep this draft");
  await userEvent.click(screen.getByRole("tab", { name: "Events" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Review alert" }),
  );
  expect(openSession).toHaveBeenCalledExactlyOnceWith("ses_existing");
  expect(screen.getByRole("tab", { name: "Events" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await userEvent.click(screen.getByRole("tab", { name: "Setting" }));
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Keep this draft",
  );
});
