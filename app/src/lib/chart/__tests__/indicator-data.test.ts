// Purpose: Only declared supported visuals enter chart projection.
import { expect, it } from "vitest";
import { indicatorPoint } from "@openchart/app/lib/chart/indicator-data";
it("projects histogram values instead of market volume and preserves gaps", () => {
  expect(
    indicatorPoint(
      {
        title: "MACD",
        series: -2,
        style: "histogram",
        color: null,
        linewidth: 1,
        offset: 0,
      },
      "series",
    ),
  ).toMatchObject({ value: -2, type: "Histogram" });
  expect(indicatorPoint(null, "series").value).toBeNull();
  expect(indicatorPoint(NaN, "numeric").value).toBeNaN();
});

it("projects a horizontal line only from its declared price field", () => {
  const value = { price: 10, title: "Level", color: null, linewidth: 1 };
  expect(indicatorPoint(value, "horizontal-line").value).toBe(10);
  expect(() => indicatorPoint(value, "series")).toThrow();
});

const plot = (style: string, overrides = {}) => ({
  series: 5,
  title: "Study",
  color: { r: 1, g: 2, b: 3, a: 128 },
  linewidth: 2,
  style,
  offset: 0,
  ...overrides,
});
it.each([
  ["area", "Area"],
  ["areabr", "Area"],
  ["columns", "Histogram"],
  ["histogram", "Histogram"],
  ["stepline", "Line"],
  ["circles", "Line"],
  ["cross", "Line"],
  ["linebr", "Line"],
])("projects %s without changing numerical values", (style, type) => {
  expect(
    indicatorPoint(plot(style!, { histbase: 50 }), "series"),
  ).toMatchObject({
    type,
    value: 5,
    base: 50,
    color: "rgba(1, 2, 3, 0.5019607843137255)",
  });
});
it("preserves hline dash and plot missing values", () => {
  expect(
    indicatorPoint(
      {
        price: 70,
        title: "Overbought",
        color: null,
        linewidth: 1,
        linestyle: "dashed",
      },
      "horizontal-line",
    ),
  ).toMatchObject({ value: 70, lineStyle: "dashed" });
  expect(
    indicatorPoint(plot("line", { series: null }), "series").value,
  ).toBeNull();
});
