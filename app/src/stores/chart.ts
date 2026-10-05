// Purpose: Keep application-wide chart presentation choices separate from each chart's state.
import * as Tz from "@openchart/chart-core/tz/types";
import { z } from "zod";
import { persist } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

const settings = z.object({
  timezone: z.string().refine(Tz.validate).default(Tz.LOCAL),
});
/** Global display timezone; Feed timestamps and requests remain unchanged. */
export const chartSettings = createStore<z.infer<typeof settings>>()(
  persist(() => settings.parse({}), {
    name: "chart-settings",
    version: 1,
    merge: (saved, current) => {
      const parsed = settings.safeParse(saved);
      return parsed.success ? parsed.data : current;
    },
  }),
);
