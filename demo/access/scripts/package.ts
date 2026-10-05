// Purpose: Build a local Electron app bundle with the Clerk OAuth URL scheme registered.
import { cp, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

const require = createRequire(import.meta.url);
const directory = fileURLToPath(new URL("..", import.meta.url));
const staging = join(directory, "dist");
await mkdir(join(staging, "node_modules"), { recursive: true });
// These runtime packages contain native assets and cannot be bundled by Vite.
for (const name of ["@anthropic-ai/claude-agent-sdk", "ws"]) {
  await cp(
    dirname(require.resolve(name)),
    join(staging, "node_modules", name),
    { recursive: true, dereference: true },
  );
}
await writeFile(
  join(staging, "package.json"),
  JSON.stringify({
    name: "openchart-access-demo",
    version: "0.0.0",
    type: "module",
    main: "main/index.js",
  }),
);
const paths = await packager({
  dir: staging,
  out: join(directory, "out"),
  name: "OpenChart Access Demo",
  appBundleId: "ai.openchart.access-demo",
  electronVersion: "44.2.0",
  protocols: [
    { name: "OpenChart sign in", schemes: ["openchart-access"] },
    { name: "OpenChart billing return", schemes: ["openchart"] },
  ],
  prune: false,
  overwrite: true,
  osxSign:
    process.platform === "darwin"
      ? {
          identity: "-",
          identityValidation: false,
          preAutoEntitlements: false,
          optionsForFile: () => ({ hardenedRuntime: false }),
        }
      : undefined,
});
console.log(paths.join("\n"));
