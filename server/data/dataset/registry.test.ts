// Purpose: Declaration registration is independent of Provider activation.
import { Schema } from "effect";
import { expect, test } from "vitest";
import {
  defineRuntimeDataset,
  k,
  Layout,
  listDefinitions,
  unregister,
} from "./index";
import { calendar } from "@openchart/server/data/providers/local";
import { openchartBars } from "@openchart/server/data/providers/openchart/datasets/definitions";
test("built-in declarations are registered without creating clients", () => {
  expect(listDefinitions()).toContain(openchartBars);
  expect(listDefinitions()).toContain(calendar);
});

test("a runtime declaration owns its name until it is unregistered", () => {
  const declaration = {
    name: "test.runtime-registry",
    keys: Schema.Struct({ time: k.range(Schema.Number) }),
    schema: Schema.Struct({ time: Schema.Number, value: Schema.Finite }),
    layout: Layout.Timeseries,
    access: { select: true },
  } as const;
  const first = defineRuntimeDataset(declaration);
  expect(first.frame).toBeDefined();
  expect(() => defineRuntimeDataset(declaration)).toThrow(/already declared/);
  unregister(first);
  const second = defineRuntimeDataset(declaration);
  // A stale handle cannot release its replacement's name.
  unregister(first);
  expect(listDefinitions()).toContain(second);
  expect(listDefinitions()).not.toContain(first);
  unregister(second);
  expect(listDefinitions()).not.toContain(second);
});
