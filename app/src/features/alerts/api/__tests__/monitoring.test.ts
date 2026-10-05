// Purpose: The app never shows green it cannot currently prove.
import { expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { NEVER } from "rxjs";
import {
  alertHealth,
  useConnection,
  type MonitoringStatus,
} from "@openchart/app/features/alerts/api/monitoring";

const rule = { id: "alr_1", enabled: true };
const status = (
  key: string,
  health: MonitoringStatus["health"],
): MonitoringStatus => ({ key, label: key, health, since: 5, checks: [] });
const failed = {
  state: "failed" as const,
  reason: { code: "alert_runner_stopped", message: "Stopped." },
};

test("paused rules show intent, not health", () => {
  expect(alertHealth({ ...rule, enabled: false }, [], "ready")).toEqual({
    state: "paused",
  });
});

test("first load is checking; only a lost connection or failed read is disconnected", () => {
  const healthy = [status("alert/alr_1", { state: "healthy" })];
  expect(alertHealth(rule, healthy, "connecting")).toMatchObject({
    state: "unknown",
    reason: { code: "checking" },
  });
  expect(alertHealth(rule, undefined, "ready")).toMatchObject({
    state: "unknown",
    reason: { code: "checking" },
  });
  expect(alertHealth(rule, healthy, "lost")).toMatchObject({
    state: "unknown",
    reason: { code: "disconnected" },
  });
  expect(alertHealth(rule, null, "ready")).toMatchObject({
    state: "unknown",
    reason: { code: "disconnected" },
  });
  expect(alertHealth(rule, [], "ready")).toMatchObject({
    state: "unknown",
    reason: { code: "not_running" },
  });
});

test("a failed alert service overrides every rule's own health", () => {
  expect(
    alertHealth(
      rule,
      [
        status("alert/alr_1", { state: "healthy" }),
        status("service/alerts", failed),
      ],
      "ready",
    ),
  ).toMatchObject(failed);
  expect(
    alertHealth(
      rule,
      [
        status("alert/alr_1", { state: "healthy" }),
        status("service/alerts", { state: "healthy" }),
      ],
      "ready",
    ),
  ).toEqual({ state: "healthy", since: 5, checks: [], retrying: false });
});

test("only the rule's own failure is retrying; a failed alert service is not", () => {
  const own = {
    state: "failed" as const,
    reason: { code: "tea.upstream", message: "Disconnected." },
  };
  expect(
    alertHealth(rule, [status("alert/alr_1", own)], "ready"),
  ).toMatchObject({
    state: "failed",
    retrying: true,
  });
  expect(
    alertHealth(
      rule,
      [
        status("alert/alr_1", { state: "healthy" }),
        status("service/alerts", failed),
      ],
      "ready",
    ),
  ).toMatchObject({ state: "failed", retrying: false });
});

test("a component mounted during an outage sees the connection as lost", () => {
  const read = (ready: boolean, wasReady: boolean) =>
    renderHook(() => useConnection({ events: NEVER, ready, wasReady })).result
      .current;
  expect(read(false, true)).toBe("lost");
  expect(read(false, false)).toBe("connecting");
  expect(read(true, true)).toBe("ready");
});
