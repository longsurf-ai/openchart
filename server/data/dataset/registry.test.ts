// Purpose: Declaration registration is independent of Provider activation.
import { expect, test } from "vitest";
import { listDefinitions } from "./index";
import { calendar } from "@openchart/server/data/providers/local";
import { openchartBars } from "@openchart/server/data/providers/openchart/datasets/definitions";
test("built-in declarations are registered without creating clients", () => {
  expect(listDefinitions()).toContain(openchartBars);
  expect(listDefinitions()).toContain(calendar);
});
