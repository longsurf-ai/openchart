// Purpose: Display-timezone civil dates become saved chart windows without live follow.
import { afterEach, expect, it, vi } from "vitest";

import {
  defaultGoToInstant,
  formatClock,
  instantToZonedParts,
  parseClock,
  viewportAroundInstant,
  visibleSpanMs,
  zonedCivilToUtcMs,
} from "@openchart/app/features/chart/utils/go-to-date";

afterEach(() => {
  vi.useRealTimers();
});

it("round-trips New York civil times across daylight-saving offsets", () => {
  const summer = Date.UTC(2026, 6, 15, 13, 30);
  const winter = Date.UTC(2026, 0, 15, 14, 30);
  expect(
    zonedCivilToUtcMs(
      { year: 2026, month: 7, day: 15, hour: 9, minute: 30 },
      "America/New_York",
    ),
  ).toBe(summer);
  expect(instantToZonedParts(summer, "America/New_York")).toEqual({
    year: 2026,
    month: 7,
    day: 15,
    hour: 9,
    minute: 30,
  });
  expect(
    zonedCivilToUtcMs(
      { year: 2026, month: 1, day: 15, hour: 9, minute: 30 },
      "America/New_York",
    ),
  ).toBe(winter);
  expect(
    zonedCivilToUtcMs(
      { year: 2026, month: 7, day: 15, hour: 13, minute: 30 },
      "UTC",
    ),
  ).toBe(summer);
});

it("accepts only 24-hour clock text", () => {
  expect(parseClock("09:30")).toEqual({ hour: 9, minute: 30 });
  expect(parseClock("23:59")).toEqual({ hour: 23, minute: 59 });
  expect(formatClock(9, 5)).toBe("09:05");
  expect(parseClock("9:30")).toBeUndefined();
  expect(parseClock("24:00")).toBeUndefined();
  expect(parseClock("")).toBeUndefined();
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
  expect(visibleSpanMs({ viewport, barSpacing: 6 }, "1d")).toBe(4_000);
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 15) });
  expect(visibleSpanMs({ viewport: null, barSpacing: 6 }, "1d", 480)).toBe(
    80 * 86_400_000,
  );
});
