// Purpose: Verify version-matched docs remain plain readable files after packaging and relocation.
import { mkdir, readFile, rename, writeFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { copyDocumentation } from "./documentation";

test("copies generated Tea and host docs, removes stale files, and survives relocation", async () => {
  const home = temporaryHome();
  const require = createRequire(import.meta.url);
  const compiler = createRequire(require.resolve("@openchart/server")).resolve(
    "tea/compiler",
  );
  const source = dirname(dirname(compiler));
  const app = join(home, "OpenChart.app");
  const target = join(app, "Contents/Resources/docs");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "stale.md"), "old version");
  await copyDocumentation(source, target);
  const relocated = join(home, "Relocated App.app");
  await rename(app, relocated);
  const docs = join(relocated, "Contents/Resources/docs");
  for (const file of [
    "introduction.md",
    "reference/builtins/core.md",
    "reference/builtins/ta.md",
  ])
    expect(await readFile(join(docs, "tea", file), "utf8")).toBe(
      await readFile(join(source, "docs", file), "utf8"),
    );
  expect(await readFile(join(docs, "openchart/tea.md"), "utf8")).toContain(
    "resource_mutate",
  );
  expect(await readFile(join(docs, "tea-lib/ta.tea"), "utf8")).toBe(
    await readFile(join(source, "dist/tea-lib/ta.tea"), "utf8"),
  );
  for (const file of [
    "stale.md",
    "tea/AGENTS.md",
    "tea/docs.json",
    "tea-lib/AGENTS.md",
    "tea-lib/ta.test.ts",
  ])
    await expect(access(join(docs, file))).rejects.toThrow();
});
