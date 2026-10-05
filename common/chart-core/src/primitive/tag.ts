// Purpose: LastValue tag primitive that renders the most recent visible value of a series on the Y-axis with a dashed line and label.
// Module:  @openchart/chart-core / primitive

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { Primitive } from "./def";
import { CoordSys } from "@openchart/chart-core/coord";
import { Color, UUID } from "@openchart/chart-core/util";
import { Draw } from "@openchart/chart-core/render";

export namespace Tag {
  // LastValue tag - shows last visible value of a series on the Y-axis
  export namespace LastValue {
    export const Options = z.object({
      visible: z.boolean().default(true),
      color: z.string().optional(),
      textColor: z.string().optional(),
      showLine: z.boolean().default(true),
      lineStyle: z.enum(["solid", "dashed", "dotted"]).default("dashed"),
    });
    export type Options = z.infer<typeof Options>;

    type State = {
      options: Options;
      y: number | null;
      value: number | null;
      seriesColor: string;
      salientColor: string;
      textColor: string;
      areaX: number;
      areaWidth: number;
      axisX: number;
      axisWidth: number;
      side: "left" | "right";
    };

    export function create(
      options?: Partial<z.input<typeof Options>>,
    ): Primitive.SeriesPrimitive {
      const opts = Options.parse(options ?? {});
      const state: State = {
        options: opts,
        y: null,
        value: null,
        seriesColor: "#2196F3",
        salientColor: "#2196F3",
        textColor: "#ffffff",
        areaX: 0,
        areaWidth: 0,
        axisX: 0,
        axisWidth: 60,
        side: "right",
      };

      const id = `tag-lastvalue-${UUID.random()}`;

      return {
        id,
        zOrder: "top",

        attached(context) {
          state.areaX = context.coord.bounds?.x ?? 0;
          state.areaWidth = context.coord.bounds?.width ?? context.width;
        },

        updateAllViews(context, data) {
          if (!state.options.visible) {
            state.y = null;
            return;
          }

          const lastIdx = data.visibleRange.to - 1;
          if (lastIdx < 0 || lastIdx >= data.data.length) {
            state.y = null;
            return;
          }

          const lastPoint = data.data[lastIdx] as
            Record<string, unknown> | undefined;
          if (!lastPoint) {
            state.y = null;
            return;
          }

          // Extract value based on data type
          const value = extractValue(lastPoint);
          if (value === null) {
            state.y = null;
            return;
          }

          state.value = value;

          // Get the scale for this series
          const scale =
            context.coord.scales.y.right ??
            Object.values(context.coord.scales.y)[0];
          if (!scale) {
            state.y = null;
            return;
          }

          state.y = CoordSys.toPixel(value, scale);
          state.areaX = context.coord.bounds.x;
          state.areaWidth = context.coord.bounds.width;

          // Determine axis position based on default scale
          const defaultScale = context.coord.defaultYScale;
          state.side = defaultScale === "left" ? "left" : "right";
          state.axisX =
            state.side === "left"
              ? 0
              : context.coord.bounds.x + context.coord.bounds.width;
          state.axisWidth = 60;

          // Get series color from options or use default
          const seriesColor = state.options.color ?? state.seriesColor;
          state.salientColor =
            state.options.color ?? Color.salient(seriesColor);
          state.textColor =
            state.options.textColor ?? Color.contrast(state.salientColor);
        },

        paneViews() {
          if (
            state.y === null ||
            state.value === null ||
            !state.options.visible
          ) {
            return [];
          }

          return [
            Primitive.view("top", {
              draw(ctx) {
                if (state.y === null || state.value === null) return;

                // Draw dashed line across chart area
                if (state.options.showLine) {
                  const pattern =
                    state.options.lineStyle === "dashed"
                      ? [4, 4]
                      : state.options.lineStyle === "dotted"
                        ? [2, 2]
                        : [];
                  Draw.dashedLine(
                    ctx,
                    state.y,
                    state.areaX,
                    state.areaX + state.areaWidth,
                    state.salientColor,
                    pattern,
                  );
                }

                // Draw value tag on axis
                const label = formatValue(state.value);
                Draw.valueTag(
                  ctx,
                  state.y,
                  label,
                  state.axisX,
                  state.axisWidth,
                  state.side,
                  state.salientColor,
                  state.textColor,
                  "12px sans-serif",
                );
              },
            }),
          ];
        },
      };
    }

    function extractValue(point: Record<string, unknown>): number | null {
      // OHLC data - use close
      if ("close" in point && typeof point.close === "number") {
        return point.close;
      }
      // Line/Histogram data - use value
      if ("value" in point && typeof point.value === "number") {
        return point.value;
      }
      return null;
    }

    function formatValue(value: number): string {
      // Use locale formatting with appropriate precision
      const absValue = Math.abs(value);
      const precision = absValue >= 1000 ? 1 : absValue >= 1 ? 2 : 4;
      return value.toLocaleString(undefined, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      });
    }
  }
}
