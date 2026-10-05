// Purpose: Product indicator defaults retain semantic colors and follow the app theme.
import { expect, it } from "vitest";
import { defaultIndicatorOutputSeriesOptions } from "@openchart/app/lib/chart/indicator-output-style";

it("maps Bollinger basis/upper/lower to amber/blue/cyan regardless of output order", () => {
  const colors = Object.fromEntries(
    ["lower", "basis", "upper"].map((outputName) => [
      outputName,
      defaultIndicatorOutputSeriesOptions({
        definitionName: "Bollinger Bands",
        outputName,
        seriesType: "Line",
      }).color,
    ]),
  );
  expect(colors).toEqual({
    basis: "#e6b94e",
    upper: "#4f8df7",
    lower: "#46bfe0",
  });
});

it("keeps Aroon up and down distinct using Tea's output names", () => {
  expect(
    ["up", "down"].map(
      (outputName) =>
        defaultIndicatorOutputSeriesOptions({
          definitionName: "Aroon",
          outputName,
          seriesType: "Line",
        }).color,
    ),
  ).toEqual(["#55b86a", "#e16672"]);
});

it("resolves the active theme token instead of freezing its fallback color", () => {
  const style = document.documentElement.style;
  const before = style.getPropertyValue("--indicator-blue");
  try {
    for (const color of ["rgb(18, 52, 86)", "rgb(180, 200, 240)"]) {
      style.setProperty("--indicator-blue", color);
      expect(
        defaultIndicatorOutputSeriesOptions({
          definitionName: "SMA",
          outputName: "value",
          seriesType: "Line",
        }).color,
      ).toBe(color);
    }
  } finally {
    if (before) style.setProperty("--indicator-blue", before);
    else style.removeProperty("--indicator-blue");
  }
});

it.each(["Line", "Histogram"] as const)(
  "uses distinct role colors for custom %s outputs",
  (seriesType) => {
    expect(
      [0, 1, 2].map(
        (outputIndex) =>
          defaultIndicatorOutputSeriesOptions({
            definitionName: "My study",
            outputName: `line${outputIndex}`,
            outputIndex,
            seriesType,
          }).color,
      ),
    ).toEqual(["#4f8df7", "#e79b3a", "#4dbd9b"]);
  },
);

it.each([
  ["Vortex Indicator", ["plus", "minus"]],
  ["Moving Average Ribbon", ["ma10", "ma20", "ma50", "ma100"]],
  ["Directional Movement", ["plus_di", "minus_di", "adx"]],
] as const)("keeps %s outputs distinct", (definitionName, names) => {
  const colors = names.map(
    (outputName, outputIndex) =>
      defaultIndicatorOutputSeriesOptions({
        definitionName,
        outputName,
        outputIndex,
        seriesType: "Line",
      }).color,
  );
  expect(new Set(colors).size).toBe(names.length);
});
