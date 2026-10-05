// Purpose: Zod schema for a vertical profile: rows along a y axis, each stretched sideways inside a box
// Module:  @openchart/chart-core / vertical-profile

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";

export namespace VerticalProfile {
  /**
   * Where the profile's box sits horizontally. `time` spans two times in
   * seconds, such as a session or a fixed range, and rows grow rightward from
   * `from`. `edge` is pinned to one side of the pane, `width` being a fraction
   * of the pane width, and rows grow inward from that side.
   */
  export const Box = z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("time"),
        from: z.number(),
        to: z.number(),
      })
      .refine(
        (box) => box.from < box.to,
        "A time box must end after it starts",
      ),
    z.object({
      kind: z.literal("edge"),
      side: z.enum(["left", "right"]),
      width: z.number().gt(0).lte(1),
    }),
  ]);
  export type Box = z.infer<typeof Box>;

  /**
   * One stacked part of a row; its length is relative to the profile's
   * longest row. `title` names the part for style controls; painting ignores it.
   */
  export const Segment = z.object({
    value: z.number().nonnegative(),
    color: z.string().min(1),
    title: z.string().optional(),
  });
  export type Segment = z.infer<typeof Segment>;

  /** A band of the y axis, such as a price range, with its segments in stacking order. */
  export const Row = z
    .object({
      low: z.number(),
      high: z.number(),
      segments: z.array(Segment),
    })
    .refine((row) => row.low < row.high, "A row's low must be below its high");
  export type Row = z.infer<typeof Row>;

  /**
   * A line across the whole box at one y value, such as a point of control.
   * `title` names the line for style controls; painting ignores it.
   */
  export const Level = z.object({
    y: z.number(),
    color: z.string().min(1),
    title: z.string().optional(),
  });
  export type Level = z.infer<typeof Level>;

  /**
   * Rows laid out along a shared y axis, each stretched sideways inside a box.
   * Rows may arrive in any order but never overlap.
   *
   * @example
   * VerticalProfile.State.parse({
   *   box: { kind: "edge", side: "right", width: 0.25 },
   *   rows: [{ low: 100, high: 101, segments: [{ value: 1200, color: "#26a69a" }] }],
   *   levels: [{ y: 100.5, color: "#f5a623" }],
   *   visible: true,
   * });
   */
  export const State = z
    .object({
      box: Box,
      rows: z.array(Row),
      levels: z.array(Level),
      visible: z.boolean(),
    })
    .refine(
      ({ rows }) =>
        [...rows]
          .sort((a, b) => a.low - b.low)
          .every((row, index, sorted) =>
            index === 0 ? true : sorted[index - 1]!.high <= row.low,
          ),
      "Profile rows must not overlap",
    );
  export type State = z.infer<typeof State>;
}
