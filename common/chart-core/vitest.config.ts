// Purpose: Run the migrated core suite with its original browser environment.
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: "chart-core",
    environment: "jsdom",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    maxWorkers: 4,
    setupFiles: ["./tests/setup.ts"],
  },
});
