// Purpose: Defaults and explicit choices remain independent across source revisions.
import { teaParameters } from "./parameters";
import { expect, it } from "vitest";
import type { Parameter } from "./metadata";
const parameter = {
  name: "length",
  title: "Length",
  type: "int",
  defaultValue: 14,
  constraints: { kind: "range", minval: 1, maxval: 100, step: 1 },
} as Parameter;
it("inherits changed defaults without losing explicit equal-to-default choices", () => {
  const original = { parameters: [parameter] };
  const edited = { parameters: [{ ...parameter, defaultValue: 20 }] };
  expect(teaParameters(original, {})).toEqual({ length: 14 });
  expect(teaParameters(edited, {})).toEqual({ length: 20 });
  expect(teaParameters(edited, { length: 14 })).toEqual({ length: 14 });
  expect(() => teaParameters(edited, { removed: 10 })).toThrow(
    "no longer exists",
  );
  expect(() => teaParameters(edited, { length: 0 })).toThrow("range");
  expect(() => teaParameters(edited, { length: "20" })).toThrow("Invalid");
});

it("rejects removed enum members and malformed color overrides", () => {
  const mode = {
    ...parameter,
    name: "mode",
    type: "enum",
    defaultValue: "new",
    constraints: null,
    enumType: { name: "Mode", members: [{ name: "new", title: "New" }] },
  } as Parameter;
  expect(() => teaParameters({ parameters: [mode] }, { mode: "old" })).toThrow(
    "enum",
  );
  const color = {
    ...parameter,
    name: "color",
    type: "color",
    defaultValue: "#ffffff",
    constraints: null,
  } as Parameter;
  expect(() =>
    teaParameters({ parameters: [color] }, { color: "red" }),
  ).toThrow("#RRGGBB");
});

it("leaves a default that follows the chart to each run unless it is chosen", () => {
  const range = {
    ...parameter,
    name: "range",
    type: "string",
    defaultValue: "Daily",
    chartDefault: true,
    constraints: { kind: "options", options: ["Daily", "Monthly"] },
  } as Parameter;
  const definition = { parameters: [range, parameter] };
  expect(teaParameters(definition, {})).toEqual({ length: 14 });
  expect(teaParameters(definition, { range: "Monthly" })).toEqual({
    range: "Monthly",
    length: 14,
  });
  expect(() => teaParameters(definition, { range: "Weekly" })).toThrow(
    "options",
  );
});
