// Purpose: A script run replaces the data file only after success and never leaves its temporary file.
import { chmod, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Exit } from "effect";
import { beforeEach, expect, test } from "vitest";
import { runScript } from "./uv";

let root: string;
let uv: string;

// Stands in for `uv run --script <file> [args]` by running the file with Node.
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "openchart-collection-"));
  uv = path.join(root, ".fake-uv");
  await writeFile(
    uv,
    `#!${process.execPath}\nconst [, , , , script, ...args] = process.argv;\nrequire("node:child_process").execFileSync(process.execPath, [script, ...args], { stdio: "inherit" });\n`,
  );
  await chmod(uv, 0o755);
  await writeFile(path.join(root, "cpi.csv"), "date,cpi\nold\n");
});

const run = (body: string, args: string[] = []) =>
  Effect.runPromiseExit(
    Effect.promise(() => writeFile(path.join(root, "collect.py"), body)).pipe(
      Effect.andThen(
        runScript({
          uv,
          runtimes: path.join(root, ".runtimes"),
          root,
          script: "collect.py",
          args,
          output: "cpi.csv",
          timeoutSeconds: 30,
        }),
      ),
    ),
  );

const leftovers = async () =>
  (await readdir(root)).filter((name) => name.endsWith(".collecting"));

test("replaces the data file with what the script wrote", async () => {
  const exit = await run(
    `require("node:fs").writeFileSync(process.env.OPENCHART_OUTPUT, "date,cpi\\n2024-01-01," + process.argv[2] + "\\n");`,
    ["308.4"],
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(await readFile(path.join(root, "cpi.csv"), "utf8")).toBe(
    "date,cpi\n2024-01-01,308.4\n",
  );
  expect(await leftovers()).toEqual([]);
});

test.each([
  [
    "a failing script",
    `require("node:fs").writeFileSync(process.env.OPENCHART_OUTPUT, "partial"); console.error("source returned 503"); process.exit(1);`,
    /source returned 503/,
  ],
  ["a script that writes nothing", ``, /without writing/],
])("keeps the data file after %s", async (_, body, message) => {
  const exit = await run(body);
  expect(Exit.isFailure(exit)).toBe(true);
  expect(JSON.stringify(exit)).toMatch(message);
  expect(await readFile(path.join(root, "cpi.csv"), "utf8")).toBe(
    "date,cpi\nold\n",
  );
  expect(await leftovers()).toEqual([]);
});
