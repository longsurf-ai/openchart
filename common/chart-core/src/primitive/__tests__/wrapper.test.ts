import { expect, it, vi } from "vitest";
import {
  PrimitiveWrapper,
  type Primitive,
} from "@openchart/chart-core/primitive";
function primitive(id: string): Primitive.SeriesPrimitive {
  return { id, zOrder: "top", paneViews: () => [], detached: vi.fn() };
}
it("replacing one indicator preserves siblings on the same market series", () => {
  const state = PrimitiveWrapper.create(),
    a = primitive("a:signal"),
    b = primitive("b:signal"),
    next = primitive("a:updated");
  PrimitiveWrapper.replaceOwned(state, "a", [a]);
  PrimitiveWrapper.replaceOwned(state, "b", [b]);
  PrimitiveWrapper.replaceOwned(state, "a", [next]);
  expect(a.detached).toHaveBeenCalledOnce();
  expect(b.detached).not.toHaveBeenCalled();
  expect([...state.primitives.keys()]).toEqual(["b:signal", "a:updated"]);
  PrimitiveWrapper.replaceOwned(state, "a", []);
  expect(next.detached).toHaveBeenCalledOnce();
  expect([...state.primitives.keys()]).toEqual(["b:signal"]);
  PrimitiveWrapper.detachAll(state);
  expect(b.detached).toHaveBeenCalledOnce();
  expect(state.owners.size).toBe(0);
});
it("rejects duplicate ids atomically before removing an owner's existing visuals", () => {
  const state = PrimitiveWrapper.create(),
    a = primitive("a"),
    b = primitive("b");
  PrimitiveWrapper.replaceOwned(state, "first", [a]);
  PrimitiveWrapper.replaceOwned(state, "second", [b]);
  expect(() =>
    PrimitiveWrapper.replaceOwned(state, "first", [primitive("b")]),
  ).toThrow("already owned");
  expect(a.detached).not.toHaveBeenCalled();
  expect([...state.primitives.keys()]).toEqual(["a", "b"]);
});
