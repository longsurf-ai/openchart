// Purpose: Tests for package export condition ordering.
// Module:  @openchart/chart-core / tests/unit

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type ExportTarget = string | Record<string, string>;

interface PackageJson {
  exports: Record<string, ExportTarget>;
}

const packagePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../package.json",
);

describe("@openchart/chart-core package exports", () => {
  it("lists types before runtime conditions so TypeScript reads source contracts", () => {
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson;

    for (const [subpath, target] of Object.entries(pkg.exports)) {
      if (typeof target === "string" || !("types" in target)) continue;

      expect(Object.keys(target)[0], `${subpath} puts types first`).toBe(
        "types",
      );
    }
  });
});
