// Purpose: Exercise the collection process boundary without downloading Python.
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";

/** Runs the uv script argument with Node in tests. @example const uv = await fakeUv(root); */
export async function fakeUv(root: string): Promise<string> {
  const uv = path.join(root, ".fake-uv");
  await writeFile(
    uv,
    `#!${process.execPath}\nconst [, , , , script, ...args] = process.argv;\nrequire("node:child_process").execFileSync(process.execPath, [script, ...args], { stdio: "inherit" });\n`,
  );
  await chmod(uv, 0o755);
  return uv;
}
