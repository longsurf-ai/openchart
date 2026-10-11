// Purpose: Exercise the actual smoke CLI executable, including Windows SEA argv and input.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { writeNativeExecutable } from "./native-executable.ts";

it("runs an isolated CLI at a path with spaces and Unicode without a shell", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openchart fixture 测试 "));
  try {
    const executable = join(
      directory,
      process.platform === "win32" ? "cli.exe" : "cli",
    );
    await writeNativeExecutable(
      executable,
      "console.log(JSON.stringify(process.argv.slice(2)));",
    );
    if (process.platform === "win32")
      expect((await readFile(executable)).subarray(0, 2).toString()).toBe("MZ");
    const result = await promisify(execFile)(
      executable,
      ["--version", "space and 中文"],
      { windowsHide: true },
    );
    expect(JSON.parse(result.stdout)).toEqual(["--version", "space and 中文"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
