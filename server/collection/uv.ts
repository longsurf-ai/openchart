// Purpose: Install the app-pinned uv on first use and run one collection script with it.
import { execFile } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { createInstallations } from "@openchart/server/models/onboarding/installation";
import { ScriptFailed } from "./errors";

const execute = promisify(execFile);

/** uv release archives, verified by SHA-512 before installation. */
export const UV_MANIFEST = {
  uv: {
    "darwin-arm64": {
      version: "0.12.0",
      url: "https://github.com/astral-sh/uv/releases/download/0.12.0/uv-aarch64-apple-darwin.tar.gz",
      integrity:
        "sha512-OBtSFCGW6XGMvzpC/yzfGVpXoy2URKo3OzkzChPH1gXZt2ifJ8zISYPtWbZpPJRNh/eYLbgWrVuSshjKOXshlQ==",
      layout: "flat",
      executable: "uv-aarch64-apple-darwin/uv",
    },
    "darwin-x64": {
      version: "0.12.0",
      url: "https://github.com/astral-sh/uv/releases/download/0.12.0/uv-x86_64-apple-darwin.tar.gz",
      integrity:
        "sha512-hD39sHZHZWgQkgfykGxOr1y/R8S9IZdWLSh/pBmmxLyQF8PZSt4TiN6YIzjFwpSdj+veW+v3Dmb+bKV7DVrKEQ==",
      layout: "flat",
      executable: "uv-x86_64-apple-darwin/uv",
    },
  },
} as const;

const tail = (text: string) =>
  text.length > 2000 ? `…${text.slice(-2000)}` : text;

/**
 * Installs the pinned uv under `runtimes` unless it is already there, without
 * output; returns its executable. Concurrent first runs share the installer's
 * atomic rename.
 * @example const uv = yield* installUv(runtimes);
 */
export const installUv = Effect.fn("Collection.installUv")(function* (
  runtimes: string,
) {
  const installations = createInstallations(runtimes, UV_MANIFEST);
  yield* Effect.tryPromise({
    try: (signal) => installations.install("uv", signal, () => {}),
    catch: (cause) =>
      new ScriptFailed({
        message: `uv could not be installed: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
  return installations.executables.uv;
});

/**
 * Runs `<uv> run --script <script> [args]` in the Workspace root and, after a
 * zero exit, moves the file the script wrote at `OPENCHART_OUTPUT` onto the
 * data file. A failed, cancelled or timed-out run removes that temporary file
 * and leaves the data file unchanged. uv-managed Python and dependency caches
 * live under `runtimes`, apart from any uv the user has. Interruption kills
 * the process.
 * @example yield* runScript({uv, runtimes, root, script: "cpi.py", args: [], output: "cpi.csv", timeoutSeconds: 600});
 */
export const runScript = Effect.fn("Collection.runScript")(function* (input: {
  readonly uv: string;
  readonly runtimes: string;
  readonly root: string;
  readonly script: string;
  readonly args: readonly string[];
  readonly output: string;
  readonly timeoutSeconds: number;
}) {
  const target = path.join(input.root, input.output);
  // A hidden sibling: the Workspace index ignores it until it replaces the file.
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.collecting`,
  );
  yield* Effect.tryPromise({
    try: async (signal) => {
      await mkdir(path.dirname(target), { recursive: true });
      await rm(temporary, { force: true });
      await execute(
        input.uv,
        ["run", "--script", path.join(input.root, input.script), ...input.args],
        {
          cwd: input.root,
          signal,
          timeout: input.timeoutSeconds * 1000,
          maxBuffer: 8 * 1024 * 1024,
          env: {
            ...process.env,
            OPENCHART_OUTPUT: temporary,
            UV_CACHE_DIR: path.join(input.runtimes, "uv-cache"),
            UV_PYTHON_INSTALL_DIR: path.join(input.runtimes, "uv-python"),
            UV_PYTHON_PREFERENCE: "only-managed",
            NO_COLOR: "1",
          },
        },
      );
      if (!(await stat(temporary).catch(() => undefined))?.isFile())
        throw new Error(
          "The script exited without writing the file named by OPENCHART_OUTPUT",
        );
      await rename(temporary, target);
    },
    // execFile rejections carry stderr, and `killed` after the timeout.
    catch: (cause) => {
      const failed = cause as { stderr?: string; killed?: boolean };
      return new ScriptFailed({
        message: failed.killed
          ? `The script ran longer than ${input.timeoutSeconds} seconds`
          : tail(
              failed.stderr?.trim() ||
                (cause instanceof Error ? cause.message : String(cause)),
            ),
      });
    },
  }).pipe(
    Effect.onExit(() => Effect.promise(() => rm(temporary, { force: true }))),
  );
});
