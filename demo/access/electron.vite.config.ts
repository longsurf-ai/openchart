// Purpose: Build the independent access demo's Electron host and React renderer.

import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { glob, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverDirectory = dirname(
  fileURLToPath(import.meta.resolve("@openchart/server")),
);

export default defineConfig({
  main: {
    plugins: [
      {
        name: "demo-server-text-assets",
        async buildStart() {
          // The shared Node backend reads these beside its compiled modules.
          for await (const file of glob("agent/**/*.txt", {
            cwd: serverDirectory,
          })) {
            const source = join(serverDirectory, file);
            this.addWatchFile(source);
            this.emitFile({
              type: "asset",
              fileName: basename(file),
              source: await readFile(source),
            });
          }
        },
      },
    ],
    build: {
      outDir: "dist/main",
      externalizeDeps: false,
      rollupOptions: { external: ["@anthropic-ai/claude-agent-sdk", "ws"] },
    },
  },
  preload: {
    build: {
      outDir: "dist/preload",
      externalizeDeps: false,
      // Sandboxed preloads must use CommonJS, even when main uses ESM.
      rollupOptions: { output: { format: "cjs", entryFileNames: "index.cjs" } },
    },
  },
  renderer: {
    plugins: [react()],
    server: { host: "127.0.0.1" },
    build: { outDir: "dist/renderer" },
  },
});
