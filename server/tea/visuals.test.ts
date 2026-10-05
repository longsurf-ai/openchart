// Purpose: Keep the shared visual translation table tied to real compiler metadata.
import { DataType, Field, Float64, List } from "apache-arrow";
import { expect, it } from "vitest";
import { tea } from "tea";
import * as Tea from "@openchart/tea";

it("recognizes nominal visuals through lists without treating data or handles as drawings", () => {
  const node = tea`
first = plot("price", close)
second = hline("level", 10.0)
fill("band", first, second)
mark = plotshape("signal", close > open)
plotchar("letter", close > open)
bgcolor("background", color.blue)
barcolor("bars", color.red)
emit.append "marks" mark
emit "raw" close
alertcondition("alert", close > open, "Up", "Price rose")
`;
  try {
    const fields = node.module.outputs.schema.fields;
    expect(
      fields.map(Tea.describeTeaVisual).filter((value) => value !== null),
    ).toEqual([
      { output: "price", kind: "series", write: "set", listDepth: 0 },
      { output: "level", kind: "horizontal-line", write: "set", listDepth: 0 },
      { output: "band", kind: "fill", write: "set", listDepth: 0 },
      { output: "signal", kind: "shape", write: "set", listDepth: 0 },
      { output: "letter", kind: "character", write: "set", listDepth: 0 },
      { output: "background", kind: "background", write: "set", listDepth: 0 },
      { output: "bars", kind: "bar-color", write: "set", listDepth: 0 },
      { output: "marks", kind: "shape", write: "append", listDepth: 1 },
    ]);

    const mark = fields.find((field) => field.name === "signal")!;
    const list = new Field(
      "shapes",
      new List(mark),
      true,
      new Map([["tea:write", "set"]]),
    );
    expect(Tea.describeTeaVisual(list)).toEqual({
      output: "shapes",
      kind: "shape",
      write: "set",
      listDepth: 1,
    });
    expect(
      Tea.describeTeaVisual(list.clone({ type: new List(list) }))?.listDepth,
    ).toBe(2);
    // Identical structural fields and short name do not confer visual meaning.
    expect(
      Tea.describeTeaVisual(
        mark.clone({
          metadata: new Map([...mark.metadata, ["tea:typeId", "@entry.Shape"]]),
        }),
      ),
    ).toBeNull();
    expect(
      Tea.describeTeaVisual(
        mark.clone({
          metadata: new Map([
            ["tea:write", "set"],
            ["tea:type", "resource"],
            ["tea:name", "line"],
          ]),
        }),
      ),
    ).toBeNull();
    expect(() =>
      Tea.describeTeaVisual(
        mark.clone({
          metadata: new Map([...mark.metadata, ["tea:write", "append"]]),
        }),
      ),
    ).toThrow("must be a List");
    expect(DataType.isStruct(mark.type)).toBe(true);
    expect(() =>
      Tea.describeTeaVisual(mark.clone({ type: new Float64() })),
    ).toThrow("must contain a Struct");
  } finally {
    node.dispose();
  }
});
