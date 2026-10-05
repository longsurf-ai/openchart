// Purpose: Keep exact Dataset identity at the provider-to-Feed binding boundary.
import { Effect, Stream } from "effect";
import { expect, test, vi } from "vitest";
import { makeDataset } from "@openchart/server/data/dataset";
import { echo } from "@openchart/server/data/dataset/tests/fixtures";
import { adaptDataset, datasetAdapter } from "./adapter";

test("only the bound declaration is adapted, even when another has the same name and fields", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const methods = {
          select: () => Effect.succeed([]),
          search: () => Effect.succeed([]),
          stream: () => Effect.succeed(Stream.empty),
        };
        const exact = yield* makeDataset(echo, methods);
        const lookalike = yield* makeDataset({ ...echo }, methods);
        const adapt = vi.fn((dataset: typeof exact) => dataset.search);
        const binding = datasetAdapter(echo, adapt);
        expect(binding.adapt(lookalike)).toBeUndefined();
        expect(adapt).not.toHaveBeenCalled();
        expect(binding.adapt(exact)).toBe(exact.search);
        expect(adapt).toHaveBeenCalledOnce();
        // Registries skip providers without this kind of binding.
        expect(adaptDataset([undefined, binding], exact)).toBe(exact.search);
        expect(adaptDataset([undefined, binding], lookalike)).toBeUndefined();
      }),
    ),
  );
});
