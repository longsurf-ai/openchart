// Purpose: Display-timezone civil dates become saved chart windows without live follow.
import { Temporal } from "temporal-polyfill";
import { expect, it } from "vitest";

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
  expect(
    Number.isFinite(
      zonedWallToUtcMs("2026-03-08", "02:30", "America/New_York"),
    ),
  ).toBe(true);
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
  expect(defaultGoToInstant({ viewport }, 9_000)).toBe(3_000);
  expect(defaultGoToInstant({ viewport: null }, 9_000)).toBe(9_000);
  expect(visibleSpanMs({ viewport, barSpacing: 6 }, "1d", 300)).toBe(4_000);
  expect(visibleSpanMs({ viewport: null, barSpacing: 6 }, "1d", 300)).toBe(
    50 * 86_400_000,
  );
});
