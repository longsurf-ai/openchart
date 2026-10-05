// Purpose: Alert columns are recognized by nominal Tea identity, never by their shape.
import { Field, Float64, List, Schema, Struct, Utf8 } from "apache-arrow";
import { expect, it } from "vitest";
import { teaAlertOutputs, teaAlertTypeId } from "./index";

// Mirrors the compiler's projection of `emit.append id Struct.new(title, message)`;
// server/tea/tea.test.ts ties the same recognition to real compiler output.
const appended = (name: string, typeId: string) =>
  new Field(
    name,
    new List(
      new Field(
        "item",
        new Struct([
          new Field("title", new Utf8(), true),
          new Field("message", new Utf8(), true),
        ]),
        true,
        new Map([
          ["tea:type", "struct"],
          ["tea:typeId", typeId],
          ["tea:name", "Alert"],
        ]),
      ),
    ),
    true,
    new Map([
      ["tea:type", "array"],
      ["tea:write", "append"],
    ]),
  );

it("finds only alertcondition columns, not visuals, numbers or lookalike user structs", () => {
  expect(teaAlertTypeId).toBe("visual.Alert");
  const outputs = new Schema([
    new Field("price", new Float64(), false, new Map([["tea:type", "float"]])),
    appended("cross", teaAlertTypeId),
    new Field(
      "sma",
      new Struct([new Field("series", new Float64(), false)]),
      true,
      new Map([
        ["tea:type", "struct"],
        ["tea:typeId", "visual.Plot"],
        ["tea:write", "set"],
      ]),
    ),
    // A user `struct Alert {title, message}` has the same fields and short name.
    appended("lookalike", "@entry.Alert"),
    appended("breakout", teaAlertTypeId),
    appended("signals", "visual.AlertEvent<@entry.Signal>"),
    appended("lookalikePayload", "@entry.AlertEvent<@entry.Signal>"),
  ]);
  expect(teaAlertOutputs(outputs)).toEqual(["cross", "breakout", "signals"]);
  expect(teaAlertOutputs(new Schema([]))).toEqual([]);
});
