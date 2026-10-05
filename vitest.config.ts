// Purpose: Bounds V2 test workers while retaining per-file isolation.

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 4,
    projects: [
      {
        extends: true,
        test: {
          name: "v2",
          globalSetup: ["./server/agent/workflow/generate-workflow-types.ts"],
          exclude: [
            ...configDefaults.exclude,
            "common/chart-core/**",
            // The standalone Vega prototype uses its own node:test runner.
            "common/chart-core-vega/**",
            "app/**",
            "sean_demo/**",
            // Tea owns its independent workspace and test runner.
            "vendor/**",
          ],
        },
      },
      "./common/chart-core/vitest.config.ts",
    ],
  },
});
