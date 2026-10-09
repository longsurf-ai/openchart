// Purpose: Opt-in smoke: the pinned uv installs and runs a PEP 723 script with managed Python and dependencies.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { installUv, runScript } from "./uv";

test.runIf(Boolean(process.env.OPENCHART_UV_LIVE))(
  "installs uv and collects through a script with inline dependencies",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openchart-uv-live-"));
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
          args: [],
          output: "datasets/cpi.csv",
          timeoutSeconds: 600,
        });
      }),
    );
    expect(await readFile(path.join(root, "datasets/cpi.csv"), "utf8")).toBe(
      "date,cpi\n2024-01-01,308.4\n",
    );
  },
  600_000,
);
