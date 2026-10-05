// Purpose: Keep Effect runtime and server implementation out of browser consumers.
import { glob, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { expect, it } from "vitest";

it("keeps shared RPC, Feed and Tea payloads in their transport owners and erases server type edges", async () => {
  const app = resolve(import.meta.dirname, "../../../..");
  const allowed = "src/lib/transport/transport.ts";
  const languageTransport = "src/features/workspace/api/tea-language-client.ts";
  const drawingInputs = new Set([
    "src/features/chart/components/menus.tsx",
    "src/features/chart/components/chart-explain-drawings.tsx",
  ]);
  const transports = new Set([
    "src/lib/feed/transport.ts",
    "src/lib/tea/index.ts",
  ]);
  const load = createRequire(import.meta.url);
  for await (const file of glob("src/**/*.{ts,tsx}", { cwd: app })) {
    if (/\.test\.tsx?$/.test(file)) continue;
    const source = await readFile(resolve(app, file), "utf8");
    // Drawing boundaries decode shared input with Schema; no Effect runtime in components.
    if (
      !transports.has(file) &&
      file !== "src/lib/feed/contracts.ts" &&
      !drawingInputs.has(file)
    )
      expect(source).not.toMatch(/(?:from\s+|import\s*)['"]effect(?:\/|['"])/);
    if (drawingInputs.has(file)) {
      const schemaImport = /import\s*\{\s*Schema\s*\}\s*from\s*['"]effect['"]/;
      expect(source).toMatch(schemaImport);
      expect(source.replace(schemaImport, "")).not.toMatch(
        /(?:from\s+|import\s*(?:\(\s*)?)['"]effect(?:\/|['"])/,
      );
    }
    if (transports.has(file)) {
      const imported = source.match(
        /import\s*\{([^}]+)\}\s*from ['"]effect['"]/,
      );
      expect(
        imported?.[1]
          ?.split(",")
          .map((name) => name.trim())
          .sort(),
      ).toEqual(["Result", "Schema"]);
    }
    if (file === "src/lib/feed/contracts.ts") {
      const imported = source.match(
        /import\s*\{([^}]+)\}\s*from ['"]effect['"]/,
      );
      expect(
        imported?.[1]
          ?.split(",")
          .map((name) => name.trim())
          .sort(),
      ).toEqual(["Predicate", "Schema"]);
    }
    if (file === allowed) continue;
    expect(source).not.toMatch(/\bnew\s+HoseClient\b/);
    if (transports.has(file)) {
      expect(source).not.toContain("@openchart/server");
      expect(source).not.toContain("createTRPCClient");
      continue;
    }
    for (const specifier of [
      "@openchart/server",
      "@trpc/client",
      "@openchart/hose",
    ]) {
      if (specifier === "@openchart/hose" && file === languageTransport)
        continue;
      expect(source).not.toContain(specifier);
    }
  }
  const source = await readFile(resolve(app, allowed), "utf8");
  expect(new Set(source.match(/@openchart\/server[^'"]*/g))).toEqual(
    new Set(["@openchart/server/contract"]),
  );
  expect(source).toMatch(
    /import\s+type\s*\{\s*AppRouter\s*\}\s+from\s+['"]@openchart\/server\/contract['"]/,
  );
  expect(() => load.resolve("@openchart/server/contract")).toThrow(
    expect.objectContaining({ code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }),
  );
  expect(
    transpileModule(source, {
      compilerOptions: {
        module: ModuleKind.ESNext,
        target: ScriptTarget.ES2022,
      },
    }).outputText,
  ).not.toContain("@openchart/server");
});
