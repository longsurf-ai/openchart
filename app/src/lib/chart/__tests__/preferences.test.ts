// Purpose: Style persistence stores user choices without materializing theme or script defaults.
// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  ChartPreferences,
  createChartPreferences,
  updateSeriesStyles,
} from "@openchart/app/lib/chart/preferences";

it("keeps overrides sparse after hydration and removes reset fields", () => {
  localStorage.clear();
  expect(
    ChartPreferences.parse({ series: { output: { color: "#ff0000" } } }).series
      .output,
  ).toEqual({ color: "#ff0000" });
  const store = createChartPreferences("style-overrides");
  updateSeriesStyles(store, ["a", "b"], { visible: false });
  updateSeriesStyles(store, ["a"], { color: "#ff0000" });
  expect(store.getState().series).toEqual({
    a: { visible: false, color: "#ff0000" },
    b: { visible: false },
  });
  const restored = createChartPreferences("style-overrides");
  expect(restored.getState().series).toEqual(store.getState().series);
  updateSeriesStyles(restored, ["a"], { color: undefined });
  expect(restored.getState().series.a).toEqual({ visible: false });
});
