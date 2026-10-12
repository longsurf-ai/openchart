// Purpose: Prove widget checks use only the bundled SDK, read declarations statically, and transpile for the renderer.
import { expect, test } from "vitest";

import { checkWidget, transpileWidget } from "./compile";

const filename = "/workspace/widgets/hello.widget.tsx";
const source = `import { useState } from "react";
import { Button, defineWidget } from "@openchart/widget";

function Hello() {
  const [count, setCount] = useState(0);
  const [label] = useState("Clicks");
  return <Button onClick={() => setCount(count + 1)}>{label}: {count}</Button>;
}

export default defineWidget({ kind: "hello", title: "Hello", Component: Hello });
`;

test("checks against SDK types and reads kind and title without running the file", () => {
  expect(checkWidget(source, filename)).toEqual({
    kind: "hello",
    title: "Hello",
  });
  expect(() =>
    checkWidget(source.replace("count + 1", 'count + "1"'), filename),
  ).toThrow(/hello\.widget\.tsx\(7,42\): error TS2345/);
});

test("rejects imports outside the module table, dynamic loading and require", () => {
  for (const line of [
    'import { readFile } from "node:fs";',
    'const fs = require("node:fs");',
    'const lazy = import("vega-embed");',
  ])
    expect(() => checkWidget(`${line}\n${source}`, filename)).toThrow(
      /hello\.widget\.tsx\(1,\d+\): .*@openchart\/widget/,
    );
});

test("requires a literal kind and title on a default-exported defineWidget", () => {
  expect(() =>
    checkWidget(source.replace(/export default[^\n]+/, ""), filename),
  ).toThrow(/Default-export defineWidget/);
  expect(() =>
    checkWidget(source.replace('kind: "hello"', "kind: `${1}`"), filename),
  ).toThrow(/\(10,\d+\): Default-export defineWidget/);
  expect(() =>
    checkWidget(source.replace('kind: "hello"', 'kind: "Hello"'), filename),
  ).toThrow(/kind must be lowercase/);
  expect(() =>
    checkWidget(source.replace('title: "Hello"', 'title: " "'), filename),
  ).toThrow(/title must be non-blank/);
});

test("transpiles to CommonJS with a source map", () => {
  const code = transpileWidget(source, "widgets/hello.widget.tsx");
  expect(code).toContain('require("react/jsx-runtime")');
  expect(code).toContain('require("@openchart/widget")');
  expect(code).toContain("sourceMappingURL=data:application/json");
});
