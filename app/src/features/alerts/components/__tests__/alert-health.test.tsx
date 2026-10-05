// Purpose: The monitoring banner stays quiet until something is wrong and never offers empty details.
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { AlertMonitoringBanner } from "@openchart/app/features/alerts/components/alert-health";

test("no banner while paused, healthy, or still checking on first load", () => {
  const { container, rerender } = render(
    <AlertMonitoringBanner health={{ state: "paused" }} />,
  );
  expect(container).toBeEmptyDOMElement();
  rerender(
    <AlertMonitoringBanner
      health={{ state: "healthy", checks: [], retrying: false }}
    />,
  );
  expect(container).toBeEmptyDOMElement();
  rerender(
    <AlertMonitoringBanner
      health={{
        state: "unknown",
        reason: { code: "checking", message: "Checking monitoring…" },
        checks: [],
        retrying: false,
      }}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});

test("a lost connection shows plain text, not a details button with nothing inside", () => {
  render(
    <AlertMonitoringBanner
      health={{
        state: "unknown",
        reason: {
          code: "disconnected",
          message: "Can't reach OpenChart's alert service.",
        },
        checks: [],
        retrying: false,
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Can't confirm this alert is monitoring · Can't reach OpenChart's alert service",
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("a stopped alert runner never claims to be retrying", () => {
  const stopped = {
    state: "failed" as const,
    reason: {
      code: "alert_runner_stopped",
      message: "Alert monitoring stopped unexpectedly. Restart OpenChart.",
    },
  };
  render(
    <AlertMonitoringBanner
      health={{
        ...stopped,
        checks: [
          { label: "Alert runner", health: stopped, since: 0, lastOkAt: 0 },
        ],
        retrying: false,
      }}
    />,
  );
  expect(screen.getByRole("button")).not.toHaveTextContent("retrying");
});
