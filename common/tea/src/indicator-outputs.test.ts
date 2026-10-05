// Purpose: Only declared supported visuals become chart bindings, and alerts read each number at its path.
import { Field, Float64, Schema, Struct } from "apache-arrow";
import { expect, it } from "vitest";
import { indicatorOutputs, indicatorSeriesOutputs } from "./indicator-outputs";
import type { CompileResponse } from "./tea";

const visual = (name: string, typeId: string) =>
  new Field(
    name,
    new Struct([]),
    true,
    new Map([
      ["tea:write", "set"],
      ["tea:typeId", typeId],
    ]),
  );
const withOutputs = (
  ...fields: Field[]
): Pick<CompileResponse, "definition" | "declaration"> => ({
  declaration: {
    kind: "indicator",
    title: "Test",
    overlay: true,
    timeframe: "",
  },
  definition: {
    parameters: [],
    inputs: new Schema([]),
    outputs: new Schema(fields),
    requests: {},
  },
});
const value = new Field(
  "value",
  new Float64(),
  true,
  new Map([["tea:write", "set"]]),
);

it("uses nominal visual types and the declared value field", () => {
  expect(indicatorOutputs(withOutputs(visual("plot", "visual.Plot")))).toEqual([
    { name: "plot", kind: "series" },
  ]);
  expect(() =>
    indicatorOutputs(withOutputs(visual("plot", "@entry.Plot"))),
  ).toThrow("not a supported");
  expect(indicatorOutputs(withOutputs(value))).toEqual([
    { name: "value", kind: "numeric" },
  ]);
  expect(
    indicatorOutputs(withOutputs(visual("vp", "visual.VerticalProfile"))),
  ).toEqual([{ name: "vp", kind: "vertical-profile" }]);
});

it("gives alerts each output's number path and leaves out lines and profiles", () => {
  expect(
    indicatorSeriesOutputs(
      withOutputs(
        visual("basis", "visual.Plot"),
        value,
        visual("level", "visual.Hline"),
        visual("vp", "visual.VerticalProfile"),
      ),
    ),
  ).toEqual([
    { name: "basis", kind: "series", path: ["basis", "series"] },
    { name: "value", kind: "numeric", path: ["value"] },
  ]);
});

it("accepts nominal decorations and candles without treating them as alert numbers", () => {
  const descriptions = [
    "Fill",
    "Shape",
    "Character",
    "Background",
    "BarColor",
    "Segment",
    "Zone",
    "Candle",
  ];
  const compiled = withOutputs(
    ...descriptions.map((name) => visual(name, `visual.${name}`)),
    value,
  );
  expect(indicatorOutputs(compiled).map((output) => output.kind)).toEqual([
    "fill",
    "shape",
    "character",
    "background",
    "bar-color",
    "segment",
    "zone",
    "candles",
    "numeric",
  ]);
  expect(indicatorSeriesOutputs(compiled)).toEqual([
    { name: "value", kind: "numeric", path: ["value"] },
  ]);
});
