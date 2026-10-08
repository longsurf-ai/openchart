// Purpose: Project the existing CSS visual system onto the canvas renderer.
import type { v2 } from "@openchart/chart-core";
import { Color } from "@openchart/chart-core/util";

/** Resolve a scoped CSS token into a color core can use for contrast and alpha. @example const color = chartTokenColor(container, '--chart-1'); */
export function chartTokenColor(element: HTMLElement, name: string) {
  const color = getComputedStyle(element).getPropertyValue(name).trim();
  if (!/^(oklch|oklab|lab|lch|color)\(/.test(color)) return color;
  // Browser color conversion avoids maintaining another CSS color parser.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return Color.toHex(r!, g!, b!);
}

/** Apply chart colors from its own DOM scope. @example applyChartTheme(draft, container); */
export function applyChartTheme(state: v2.Chart.State, element: HTMLElement) {
  state.config.chart.layout.background = chartTokenColor(
    element,
    "--background",
  );
  state.config.chart.layout.textColor = chartTokenColor(
    element,
    "--chart-text",
  );
  state.config.chart.grid.color = chartTokenColor(element, "--chart-grid");
  // Session tints are translucent; keep their tokens in rgb()/hsl() so this
  // projection never flattens them through the opaque oklch conversion.
  const bands = state.config.chart.sessionBands;
  bands.pre = chartTokenColor(element, "--chart-session-pre");
  bands.post = chartTokenColor(element, "--chart-session-post");
  bands.overnight = chartTokenColor(element, "--chart-session-overnight");
}
