// Purpose: Display-timezone civil dates become saved chart windows without live follow.
import { Temporal } from "temporal-polyfill";
import { expect, it } from "vitest";
import { v2 } from "@openchart/chart-core";

import {
  defaultGoToInstant,
  viewportAroundInstant,
  visibleSpanMs,
  zonedWallFromUtcMs,
  zonedWallToUtcMs,
} from "@openchart/app/features/chart/utils/go-to-date";

it("round-trips New York civil times across daylight-saving offsets", () => {
  const summer = Date.UTC(2026, 6, 15, 13, 30);
  const winter = Date.UTC(2026, 0, 15, 14, 30);
  expect(zonedWallToUtcMs("2026-07-15", "09:30", "America/New_York")).toBe(
    summer,
  );
  expect(zonedWallFromUtcMs(summer, "America/New_York")).toEqual({
    date: "2026-07-15",
    time: "09:30",
  });
  expect(zonedWallToUtcMs("2026-01-15", "09:30", "America/New_York")).toBe(
    winter,
  );
  expect(zonedWallToUtcMs("2026-07-15", "13:30", "UTC")).toBe(summer);
});

it("advances a nonexistent spring time and selects the earlier autumn time", () => {
  expect(zonedWallToUtcMs("2026-03-08", "02:30", "America/New_York")).toBe(
    Date.UTC(2026, 2, 8, 7, 30),
  );
  expect(zonedWallToUtcMs("2026-11-01", "01:30", "America/New_York")).toBe(
    Date.UTC(2026, 10, 1, 5, 30),
  );
});

it("resolves the local display setting to the host zone", () => {
  const instant = Date.UTC(2026, 6, 15, 13, 30);
  expect(zonedWallFromUtcMs(instant, "local")).toEqual(
    zonedWallFromUtcMs(instant, Temporal.Now.timeZoneId()),
  );
});

it("centers a historical instant and pins the right edge at now", () => {
  const now = Date.UTC(2026, 9, 15);
  const span = 10 * 86_400_000;
  expect(
    viewportAroundInstant(Date.UTC(2024, 0, 2), { spanMs: span, now }),
  ).toEqual({
    from: Date.UTC(2023, 11, 28),
    to: Date.UTC(2024, 0, 7),
  });
  const nearLatest = viewportAroundInstant(now - 1000, { spanMs: span, now });
  expect(nearLatest.to).toBe(now);
  expect(nearLatest.to - nearLatest.from).toBe(span);
});

it("uses the saved window as the jump span and default instant", () => {
  const viewport = { from: 1_000, to: 5_000 };
  const state = v2.createState();
  expect(defaultGoToInstant({ viewport }, 9_000)).toBe(3_000);
  expect(defaultGoToInstant({ viewport: null }, 9_000)).toBe(9_000);
  expect(visibleSpanMs({ viewport, barSpacing: 6 }, "1d", state)).toBe(4_000);
});

it("estimates from plot width and spacing before a timeline is available", () => {
  const state = v2.createState();
  state.config.chart.dimensions = {
    ...state.config.chart.dimensions,
    width: 360,
    height: 240,
  };
  expect(visibleSpanMs({ viewport: null, barSpacing: 6 }, "1d", state)).toBe(
    51 * 86_400_000,
  );
});
