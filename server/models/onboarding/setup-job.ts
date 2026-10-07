// Purpose: Executes one native setup job and records its bounded output and completion.
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify, stripVTControlCharacters } from "node:util";
import { Cause, Effect, Exit, Fiber, Queue, Stream, Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type { ProviderDiscoveryResult } from "@openchart/models/model-provider";
import type { ModelError } from "@openchart/server/models/errors";
import type { SetupAction, SetupState } from "./setup-state";
import { SetupFailed } from "./errors";

type SetupCommand = Extract<
  ProviderDiscoveryResult,
  { status: "authentication_required" }
>["login"];

/** One in-memory job; onboarding.ts owns registration, input, and fiber cancellation. */
export type SetupJob = {
  state: Exclude<SetupState, { status: "idle" }>;
  input: Queue.Queue<Uint8Array>;
  fiber?: Fiber.Fiber<void>;
};

/**
 * Creates an accepted job with bounded stdin; performs no process I/O.
 * The owner must run it with {@link runSetupJob}, which shuts down its input.
 * @example const job = yield* makeSetupJob("login");
 */
export const makeSetupJob = Effect.fn("Models.setup.makeSetupJob")(function* (
  action: SetupAction,
): Effect.fn.Return<SetupJob> {
  const input = yield* Queue.make<Uint8Array>({ capacity: 16 });
  return {
    state: { status: "running", id: randomUUID(), action, output: "" },
    input,
  };
});

/**
 * Runs one installation or native login and awaits resource cleanup.
 * A deadline bounds execution; failures become retained job state. Completion
 * refreshes models, while interruption leaves refresh to the cancelling caller.
 * @example yield* runSetupJob(job, operation, refresh, changed);
 */
export const runSetupJob = Effect.fn("Models.setup.runSetupJob")(function* (
  job: SetupJob,
  operation: Effect.Effect<void, unknown, Scope.Scope>,
  refresh: () => Effect.Effect<void, ModelError>,
  changed: Effect.Effect<void>,
) {
  yield* operation.pipe(
    Effect.timeout("15 minutes"),
    Effect.scoped,
    Effect.onExit((exit) => finishSetupJob(job, exit, refresh, changed)),
    // Failure is represented by retained state, never an unobserved fiber error.
    Effect.ignore,
  );
});

/**
 * Runs trusted login argv with inherited native auth environment. Terminal login
 * uses Windows ConPTY; ordinary commands use scoped pipes. The owner closes input,
 * awaits process cleanup on cancellation/deadline, and retains bounded output.
 * Unsupported terminal hosts, spawn errors and nonzero exits fail with SetupFailed.
 * @example yield* executeSetupCommand(job, command, spawner);
 */
export const executeSetupCommand = Effect.fn(
  "Models.setup.executeSetupCommand",
)(function* (
  job: SetupJob,
  command: SetupCommand,
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
) {
  if (command.terminal) return yield* executeTerminalCommand(job, command);
  const process = yield* spawner.spawn(
    ChildProcess.make(command.executable, command.args, {
      extendEnv: true,
      env: { DISABLE_AUTOUPDATER: "1" },
      windowsHide: true,
      // Native CLIs own their auth/config; discovery never starts this process.
      stdin: Stream.fromQueue(job.input),
      forceKillAfter: "2 seconds",
    }),
  );
  yield* process.all.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) => Effect.sync(() => appendOutput(job, chunk))),
  );
  const code = yield* process.exitCode;
  if (code !== 0)
    return yield* new SetupFailed({
      message: `Sign-in exited with code ${code}.`,
    });
});

const executeTerminalCommand = Effect.fn("Models.setup.executeTerminalCommand")(
  function* (job: SetupJob, command: SetupCommand) {
    if (process.platform !== "win32")
      return yield* new SetupFailed({
        message: "Terminal sign-in is unavailable on this platform.",
      });
    const resource = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          // Native dependencies are staged only for Windows and loaded only for login.
          const pty = await import("node-pty");
          const terminal = pty.spawn(command.executable, [...command.args], {
            name: "xterm-color",
            cols: 120,
            rows: 30,
            useConpty: true,
            env: {
              ...process.env,
              DISABLE_AUTOUPDATER: "1",
              AGY_CLI_DISABLE_AUTO_UPDATE: "true",
            },
          });
          let ended = false;
          let resolveExit!: (code: number) => void;
          const exit = new Promise<number>((resolve) => {
            resolveExit = resolve;
          });
          const output = terminal.onData((chunk) => appendOutput(job, chunk));
          const completion = terminal.onExit(({ exitCode }) => {
            ended = true;
            resolveExit(exitCode);
          });
          return { terminal, exit, output, completion, ended: () => ended };
        },
        catch: (cause) =>
          new SetupFailed({
            message:
              cause instanceof Error
                ? cause.message
                : "Could not start terminal sign-in.",
          }),
      }),
      (resource) =>
        Effect.promise(async () => {
          try {
            if (!resource.ended()) {
              // Killing only the CLI leaves descendants holding the console alive.
              try {
                await promisify(execFile)(
                  path.win32.join(
                    process.env.SystemRoot ?? "C:\\Windows",
                    "System32",
                    "taskkill.exe",
                  ),
                  ["/PID", String(resource.terminal.pid), "/T", "/F"],
                  { windowsHide: true, timeout: 5_000, maxBuffer: 16_384 },
                );
              } catch (cause) {
                // A natural exit racing cancellation makes taskkill report no process.
                if (!resource.ended()) throw cause;
              } finally {
                if (!resource.ended()) resource.terminal.kill();
              }
              await Promise.race([
                resource.exit,
                delay(2_000, undefined, { ref: false }),
              ]);
              if (!resource.ended())
                throw new Error(
                  "Terminal sign-in did not exit after termination.",
                );
            }
          } finally {
            resource.output.dispose();
            resource.completion.dispose();
          }
        }),
    );
    const input = Stream.fromQueue(job.input).pipe(
      Stream.decodeText(),
      Stream.runForEach((text) =>
        Effect.try({
          try: () => resource.terminal.write(text.replace(/\r?\n/g, "\r")),
          catch: () =>
            new SetupFailed({ message: "Could not send sign-in input." }),
        }),
      ),
      Effect.andThen(Effect.never),
    );
    const code = yield* Effect.raceFirst(
      Effect.promise(() => resource.exit),
      input,
    );
    if (code !== 0)
      return yield* new SetupFailed({
        message: `Sign-in exited with code ${code}.`,
      });
  },
);

const finishSetupJob = Effect.fn("Models.setup.finishSetupJob")(function* (
  job: SetupJob,
  exit: Exit.Exit<void, unknown>,
  refresh: () => Effect.Effect<void, ModelError>,
  changed: Effect.Effect<void>,
) {
  yield* Queue.shutdown(job.input);
  const status = completionStatus(exit);
  // Expected installation/process failures remain visible in the bounded setup output.
  if (Exit.isFailure(exit) && status === "failed") {
    const failure = Cause.findErrorOption(exit.cause);
    if (failure._tag === "Some" && failure.value instanceof Error)
      appendOutput(job, "\n" + failure.value.message);
  }
  if (status === "failed")
    appendOutput(
      job,
      "\nSetup did not complete. Check the output and try again.",
    );
  // The next discovery read reports a refresh failure on the provider card.
  if (status !== "cancelled")
    yield* refresh().pipe(
      Effect.ignore({ log: "Warn", message: "Setup could not refresh models" }),
    );
  job.state = { ...job.state, status };
  if (status !== "cancelled") yield* changed;
});

function completionStatus(exit: Exit.Exit<void, unknown>) {
  if (Exit.isSuccess(exit)) return "succeeded";
  return Cause.hasInterrupts(exit.cause) ? "cancelled" : "failed";
}

function appendOutput(job: SetupJob, text: string) {
  job.state = {
    ...job.state,
    output: stripVTControlCharacters(job.state.output + text).slice(-32_768),
  };
}
