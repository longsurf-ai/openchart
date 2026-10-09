// Purpose: Chart colors come from the chart's own CSS scope, keeping translucent session tints.
import { v2 } from "@openchart/chart-core";
import { expect, it } from "vitest";
import { applyChartTheme } from "@openchart/app/lib/chart/theme";

it("projects scoped session tokens into the renderer config without dropping alpha", () => {
  const element = document.createElement("div");
  element.style.setProperty("--chart-session-pre", "rgb(255 167 38 / 0.09)");
  element.style.setProperty("--chart-session-post", "rgb(41 98 255 / 0.14)");
  element.style.setProperty("--chart-session-overnight", "rgb(1 2 3 / 0.5)");
  document.body.append(element);
  const state = v2.createState({ id: "theme" });
  applyChartTheme(state, element);
  expect(state.config.chart.sessionBands).toEqual({
    pre: "rgb(255 167 38 / 0.09)",
    post: "rgb(41 98 255 / 0.14)",
    overnight: "rgb(1 2 3 / 0.5)",
  });
  element.remove();
});
