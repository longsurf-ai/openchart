// Purpose: Opt-in smoke: the pinned uv installs and runs a PEP 723 script with managed Python and dependencies.
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Exit } from "effect";
import { expect, test, vi, onTestFinished } from "vitest";
import { installUv, runScript } from "./uv";

test.runIf(Boolean(process.env.OPENCHART_UV_LIVE))(
  "runs inline dependencies without importing mutable Workspace modules or configuration",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openchart-uv-live-"));
    onTestFinished(() => vi.unstubAllEnvs());
    vi.stubEnv("PYTHONPATH", root);
    const payload =
      'from pathlib import Path\nPath("unapproved-ran").write_text("executed")\n';
    await writeFile(path.join(root, "helper.py"), payload);
    await writeFile(path.join(root, "dateutil.py"), payload);
    await writeFile(path.join(root, "sitecustomize.py"), payload);
    await writeFile(
      path.join(root, "uv.toml"),
      "invalid Workspace uv configuration",
    );
    await writeFile(
      path.join(root, "collect.py"),
      [
        "# /// script",
        '# requires-python = ">=3.12"',
        '# dependencies = ["python-dateutil"]',
        "# ///",
        "import os",
        "from dateutil.parser import isoparse",
        'day = isoparse("2024-01-01").date().isoformat()',
        'open(os.environ["OPENCHART_OUTPUT"], "w").write(f"date,cpi\\n{day},308.4\\n")',
        "",
      ].join("\n"),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const runtimes = path.join(root, ".runtimes");
        const uv = yield* installUv(runtimes);
        yield* runScript({
          uv,
          runtimes,
          root,
          script: "collect.py",
          content: yield* Effect.promise(() =>
            readFile(path.join(root, "collect.py")),
          ),
          args: [],
          output: "datasets/cpi.csv",
          timeoutSeconds: 600,
        });
        const imported = yield* Effect.exit(
          runScript({
            uv,
            runtimes,
            root,
            script: "collect.py",
            content: Buffer.from("import helper\n"),
            args: [],
            output: "datasets/cpi.csv",
            timeoutSeconds: 600,
          }),
        );
        expect(Exit.isFailure(imported)).toBe(true);
        expect(JSON.stringify(imported)).toContain("No module named 'helper'");
      }),
    );
    expect(await readFile(path.join(root, "datasets/cpi.csv"), "utf8")).toBe(
      "date,cpi\n2024-01-01,308.4\n",
    );
    await expect(
      access(path.join(root, "unapproved-ran")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
  600_000,
);
