// Purpose: Feed lifecycle tests run independently of the app-wide MSW harness.
import viteTsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [viteTsconfigPaths({ projects: ["../tsconfig.json"] })],
  test: {
    maxWorkers: 4,
    environment: "node",
    globals: true,
    include: [
      "src/lib/feed/**/*.test.ts",
      "src/lib/tea/**/*.test.ts",
      "src/features/agent/ag-ui/**/*.test.ts",
      "src/features/agent/components/thread/transcript/markdown/__tests__/markdown-math.test.ts",
      "src/lib/agent/**/*.test.{ts,tsx}",
      "src/hooks/__tests__/use-bars.test.tsx",
      "src/hooks/__tests__/use-tea.test.tsx",
      "src/app/connection/**/*.test.tsx",
      "src/features/chart/**/*.test.tsx",
    ],
  },
});
