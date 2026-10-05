// Purpose: Stage version-matched, ordinary documentation files for native Agent readers.
import { cp, mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies Tea-owned Markdown and OpenChart-owned integration guidance into one
 * host asset directory from the installed package used by the compiler.
 * Tea commits its generated reference, and its package build owns the compiled
 * library sources.
 * Replaces old assets so removed documentation cannot survive a rebuild.
 * @example await copyDocumentation(teaPackageRoot, documentationStaging);
 */
export async function copyDocumentation(teaDirectory: string, target: string) {
  await rm(target, { recursive: true, force: true });
  await cp(join(teaDirectory, "docs"), join(target, "tea"), {
    recursive: true,
    filter: (file) =>
      !["AGENTS.md", "CLAUDE.md", "docs.json"].includes(basename(file)),
  });
  await cp(join(teaDirectory, "dist/tea-lib"), join(target, "tea-lib"), {
    recursive: true,
  });
  await mkdir(join(target, "openchart"), { recursive: true });
  await cp(
    fileURLToPath(new URL("../../../docs/agent/tea.md", import.meta.url)),
    join(target, "openchart/tea.md"),
  );
}
