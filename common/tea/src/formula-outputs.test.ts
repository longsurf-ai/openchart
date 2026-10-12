// Purpose: Formula output selection tolerates unsupported siblings and admits only scalar number paths.
import {
  Bool,
  Field,
  Float64,
  Int32,
  Int64,
  List,
  Schema,
  Struct,
  Uint32,
  Uint64,
  Utf8,
} from "apache-arrow";
import { expect, test } from "vitest";
import { formulaOutputs } from "./formula-outputs";
import type { CompileResponse } from "./tea";

const field = (name: string, type = new Float64(), write = "set") =>
  new Field(name, type, true, new Map([["tea:write", write]]));
const compiled = (...fields: Field[]): Pick<CompileResponse, "definition"> => ({
  definition: {
    parameters: [],
    inputs: new Schema([]),
    outputs: new Schema(fields),
    requests: {},
  },
});
const plot = new Field(
  "plot",
  new Struct([]),
  true,
  new Map([
    ["tea:write", "set"],
    ["tea:typeId", "visual.Plot"],
  ]),
);

test("numeric and Plot outputs remain eligible beside unsupported or appended fields", () => {
  expect(
    formulaOutputs(
      compiled(
        field("number"),
        new Field(
          "integer",
          new Int32(),
          true,
          new Map([["tea:write", "set"]]),
        ),
        plot,
        new Field("text", new Utf8(), true, new Map([["tea:write", "set"]])),
        new Field("flag", new Bool(), true, new Map([["tea:write", "set"]])),
        field("append", new Float64(), "append"),
        new Field("internal", new Float64()),
        new Field(
          "plots",
          new List(plot),
          true,
          new Map([["tea:write", "set"]]),
        ),
      ),
    ),
  ).toEqual([
    { name: "number", kind: "numeric", path: ["number"] },
    { name: "integer", kind: "numeric", path: ["integer"] },
    { name: "plot", kind: "series", path: ["plot", "series"] },
  ]);
});

test("no eligible output is an empty result, independent of an indicator declaration", () => {
  expect(formulaOutputs(compiled())).toEqual([]);
  expect(
    formulaOutputs(
      compiled(
        new Field(
          "value",
          new Struct([]),
          true,
          new Map([
            ["tea:write", "set"],
            ["tea:typeId", "@entry.Plot"],
          ]),
        ),
      ),
    ),
  ).toEqual([]);
});

test("excludes bigint fields while retaining compiler int outputs and number-backed unsigned integers", () => {
  expect(
    formulaOutputs(
      compiled(
        new Field(
          "tea_int",
          new Float64(),
          false,
          new Map([
            ["tea:write", "set"],
            ["tea:type", "int"],
          ]),
        ),
        new Field(
          "unsigned",
          new Uint32(),
          true,
          new Map([["tea:write", "set"]]),
        ),
        new Field(
          "signed64",
          new Int64(),
          true,
          new Map([["tea:write", "set"]]),
        ),
        new Field(
          "unsigned64",
          new Uint64(),
          true,
          new Map([["tea:write", "set"]]),
        ),
      ),
    ),
  ).toEqual([
    { name: "tea_int", kind: "numeric", path: ["tea_int"] },
    { name: "unsigned", kind: "numeric", path: ["unsigned"] },
  ]);
});
