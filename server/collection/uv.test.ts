// Purpose: A script run replaces the data file only after success and never leaves its temporary file.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Effect, Exit } from "effect";
import { beforeEach, expect, test, vi } from "vitest";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { runScript } from "./uv";
import { fakeUv } from "./uv.test-utils";

let root: string;
let uv: string;

// Stands in for `uv run --script <file> [args]` by running the file with Node.
beforeEach(async () => {
  root = temporaryHome();
  uv = await fakeUv(root);
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
          content: Buffer.from(body),
          args,
          output: "cpi.csv",
          timeoutSeconds: 30,
        }),
      ),
    ),
  );

const leftovers = async () =>
  (await readdir(root, { recursive: true })).filter(
    (name) =>
      name.includes("collection-runs/") ||
      name.endsWith(".collecting") ||
      (name.startsWith(".") && name.endsWith(".py")),
  );

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

test("executes the approved bytes even after the source is edited", async () => {
  await writeFile(
    path.join(root, "collect.py"),
    "throw new Error('unapproved');",
  );
  await Effect.runPromise(
    runScript({
      uv,
      runtimes: root,
      root,
      script: "collect.py",
      content: Buffer.from(
        "require('node:fs').writeFileSync(process.env.OPENCHART_OUTPUT, 'approved');",
      ),
      args: [],
      output: "cpi.csv",
      timeoutSeconds: 30,
    }),
  );
  expect(await readFile(path.join(root, "cpi.csv"), "utf8")).toBe("approved");
  expect(await leftovers()).toEqual([]);
});

test("concurrent runs never publish or remove another run's staged output", async () => {
  const body = (name: string, output: string, code: number) =>
    `const fs=require('node:fs'); fs.writeFileSync(process.env.OPENCHART_OUTPUT, ${JSON.stringify(output)}); fs.writeFileSync('${name}.ready', ''); const timer=setInterval(()=>{if(fs.existsSync('${name}.release')){clearInterval(timer);process.exit(${code});}},10);`;
  const start = (name: string, output: string, code: number) =>
    Effect.runPromiseExit(
      runScript({
        uv,
        root,
        runtimes: root,
        script: `${name}.py`,
        content: Buffer.from(body(name, output, code)),
        args: [],
        output: "cpi.csv",
        timeoutSeconds: 5,
      }),
    );
  const a = start("a", "complete", 0);
  await vi.waitFor(() => readFile(path.join(root, "a.ready")));
  const b = start("b", "partial", 1);
  try {
    await vi.waitFor(() => readFile(path.join(root, "b.ready")));
    await writeFile(path.join(root, "a.release"), "");
    expect(Exit.isSuccess(await a)).toBe(true);
    expect(await readFile(path.join(root, "cpi.csv"), "utf8")).toBe("complete");
  } finally {
    await writeFile(path.join(root, "a.release"), "");
    await writeFile(path.join(root, "b.release"), "");
    await a;
    expect(Exit.isFailure(await b)).toBe(true);
  }
  expect(await readFile(path.join(root, "cpi.csv"), "utf8")).toBe("complete");
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
