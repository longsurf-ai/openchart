// Purpose: Persist grid proportions after a completed gesture and validate stored preferences once.
import { z } from "zod";
import { persist } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

const layoutState = z.object({
  ratios: z
    .record(
      z.string(),
      z.object({
        columns: z.array(z.number().positive()).readonly(),
        rows: z.array(z.number().positive()).readonly(),
      }),
    )
    .default({}),
});

/** One normal persisted local store per grid, with no renderer or geometry cache. @example const store = createLayoutStore(grid.id); */
export function createLayoutStore(id: string) {
  return createStore<z.infer<typeof layoutState>>()(
    persist(() => layoutState.parse({}), {
      name: `local:chart-grid:${id}`,
      version: 1,
      merge: (saved, current) => {
        const parsed = layoutState.safeParse(saved);
        return parsed.success ? parsed.data : current;
      },
    }),
  );
}
