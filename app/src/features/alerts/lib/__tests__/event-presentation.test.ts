// Purpose: Preserve source facts and local occurrence days when presenting historical fires.
import { expect, test } from "vitest";
import type { AlertEvent } from "../../api/queries";
import { alertEventFacts, groupAlertEvents } from "../event-presentation";

const event = (data: AlertEvent["detail"]["data"], time = 0): AlertEvent => ({
  id: "ale_test" as AlertEvent["id"],
  ruleId: "alr_test" as AlertEvent["ruleId"],
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
  time,
  condition: "alert",
  detail: { title: "Test", message: "", data },
});

test("saved explicit scalars win, including zero; input bindings never invent identity", () => {
  expect(
    alertEventFacts(
      event({
        value: 0,
        values: { value: 8 },
        threshold: 0,
        parameters: { threshold: 20 },
        symbol: "CHILD",
        inputs: { listing: { symbol: "ROOT" } },
      }),
    ),
  ).toEqual({
    value: "0",
    threshold: "0",
    symbol: "CHILD",
    provider: undefined,
    resolution: undefined,
  });
  expect(
    alertEventFacts(
      event({
        values: { close: 100 },
        inputs: {
          listing: { symbol: "ROOT" },
          provider: "test",
          resolution: "1m",
        },
      }),
    ),
  ).toEqual({
    value: undefined,
    threshold: undefined,
    symbol: undefined,
    provider: undefined,
    resolution: undefined,
  });
  expect(alertEventFacts(event({ values: { value: 12.3456789 } })).value).toBe(
    "12.3456789",
  );
  expect(alertEventFacts(event({ value: 85488.65 })).value).toBe("85,488.65");
  expect(alertEventFacts(event({ value: "001.230" })).value).toBe("001.230");
});

test("single generated thresholds are readable but composite or unused threshold defaults stay absent", () => {
  expect(
    alertEventFacts(
      event({ parameters: { c0_op: "crossing", c0_threshold: 58.05561 } }),
    ).threshold,
  ).toBe("58.05561");
  expect(
    alertEventFacts(
      event({
        parameters: {
          c0_op: "crossing",
          c0_threshold: 58,
          c1_op: "greater_than",
          c1_threshold: 100,
        },
      }),
    ).threshold,
  ).toBeUndefined();
  expect(
    alertEventFacts(
      event({ parameters: { op: "moving_up", threshold: 0, amount: 10 } }),
    ).threshold,
  ).toBeUndefined();
});

test("groups occurrence dates across local midnight and retains separate same-time fires", () => {
  const now = new Date(2026, 9, 5, 12);
  const today = event({}, new Date(2026, 9, 5, 0, 1).getTime());
  const yesterday = event({}, new Date(2026, 9, 4, 23, 59).getTime());
  const groups = groupAlertEvents(
    [today, { ...today, id: "ale_repeat" as AlertEvent["id"] }, yesterday],
    now,
  );
  expect(groups.map((group) => [group.label, group.events.length])).toEqual([
    ["Today · Oct 5, 2026", 2],
    ["Yesterday · Oct 4, 2026", 1],
  ]);
});

test.each([
  ["2026-03-09T04:30:00Z", "2026-03-08T16:00:00Z", "Yesterday · Mar 8, 2026"],
  ["2026-11-02T04:30:00Z", "2026-10-31T16:00:00Z", "Yesterday · Oct 31, 2026"],
  ["2027-01-01T05:30:00Z", "2026-12-31T16:00:00Z", "Yesterday · Dec 31, 2026"],
])(
  "selected-zone Yesterday uses calendar arithmetic at %s",
  (now, occurrence, label) => {
    const groups = groupAlertEvents(
      [event({}, Date.parse(occurrence))],
      new Date(now),
      "America/New_York",
    );
    expect(groups.map((group) => group.label)).toEqual([label]);
  },
);
