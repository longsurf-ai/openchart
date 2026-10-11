// Purpose: Verifies Windows terminal setup input, bounded output, failure and scoped cleanup without a real login.
import { Effect, Fiber, Queue } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { executeSetupCommand, makeSetupJob, runSetupJob } from "./setup-job";

const native = vi.hoisted(() => ({ spawn: vi.fn(), taskkill: vi.fn() }));
vi.mock("node-pty", () => ({ spawn: native.spawn }));
vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: native.taskkill,
  }),
}));

const fibers: Fiber.Fiber<void>[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "process",
    Object.create(process, { platform: { value: "win32" } }),
  );
});
afterEach(async () => {
  await Promise.all(
    fibers.splice(0).map((fiber) => Effect.runPromise(Fiber.interrupt(fiber))),
  );
  vi.unstubAllGlobals();
});

async function fixture(deadline = false) {
  let data!: (text: string) => void;
  let exit!: (event: { exitCode: number }) => void;
  const outputDisposed = vi.fn();
  const exitDisposed = vi.fn();
  const terminal = {
    pid: 4321,
    write: vi.fn(),
    kill: vi.fn(() => exit({ exitCode: 1 })),
    onData: vi.fn((listener: typeof data) => {
      data = listener;
      return { dispose: outputDisposed };
    }),
    onExit: vi.fn((listener: typeof exit) => {
      exit = listener;
      return { dispose: exitDisposed };
    }),
  };
  native.spawn.mockReturnValue(terminal);
  native.taskkill.mockImplementation(async () => {
    exit({ exitCode: 1 });
    return { stdout: "", stderr: "" };
  });
  const job = await Effect.runPromise(makeSetupJob("login"));
  const refresh = vi.fn(() => Effect.void);
  const spawn = vi.fn(() =>
    Effect.die("Piped spawner must not run for a terminal login"),
  );
  const spawner = {
    spawn,
  } as unknown as ChildProcessSpawner.ChildProcessSpawner["Service"];
  const operation = executeSetupCommand(
    job,
    {
      executable: "C:\\managed\\antigravity.exe",
      args: ["-p", "/usage"],
      terminal: true,
    },
    spawner,
  );
  const fiber = Effect.runFork(
    runSetupJob(
      job,
      deadline ? operation.pipe(Effect.timeout("100 millis")) : operation,
      refresh,
      Effect.void,
    ),
  );
  fibers.push(fiber);
  await vi.waitFor(() => expect(native.spawn).toHaveBeenCalledOnce());
  return {
    job,
    fiber,
    terminal,
    refresh,
    spawn,
    outputDisposed,
    exitDisposed,
    data: (text: string) => data(text),
    exit: (code: number) => exit({ exitCode: code }),
  };
}

test("uses direct ConPTY argv, terminal line endings, bounded plain output, and native exit status", async () => {
  const f = await fixture();
  expect(native.spawn).toHaveBeenCalledWith(
    "C:\\managed\\antigravity.exe",
    ["-p", "/usage"],
    expect.objectContaining({
      useConpty: true,
      env: expect.objectContaining({ AGY_CLI_DISABLE_AUTO_UPDATE: "true" }),
    }),
  );
  f.data("x".repeat(40_000) + "\u001b[31mPaste code:\u001b[0m");
  await Effect.runPromise(
    Queue.offer(
      f.job.input,
      new TextEncoder().encode("literal; $(unsafe)\r\n"),
    ),
  );
  await vi.waitFor(() =>
    expect(f.terminal.write).toHaveBeenCalledWith("literal; $(unsafe)\r"),
  );
  f.exit(0);
  await Effect.runPromise(Fiber.join(f.fiber));
  expect(f.job.state).toMatchObject({
    status: "succeeded",
    output: expect.stringContaining("Paste code:"),
  });
  expect(f.job.state.output.length).toBeLessThanOrEqual(32768);
  expect(f.job.state.output).not.toContain("\u001b");
  expect(f.refresh).toHaveBeenCalledOnce();
  expect(f.spawn).not.toHaveBeenCalled();
  expect(native.taskkill).not.toHaveBeenCalled();
  expect(f.outputDisposed).toHaveBeenCalledOnce();
  expect(f.exitDisposed).toHaveBeenCalledOnce();
});

test("a terminal deadline terminates the process tree and reports failure", async () => {
  const f = await fixture(true);
  await Effect.runPromise(Fiber.join(f.fiber));
  expect(f.job.state.status).toBe("failed");
  expect(native.taskkill).toHaveBeenCalledOnce();
  expect(f.outputDisposed).toHaveBeenCalledOnce();
  expect(f.refresh).toHaveBeenCalledOnce();
});

test("cancellation awaits process-tree termination before completing cleanup", async () => {
  const f = await fixture();
  let finishKill!: () => void;
  native.taskkill.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishKill = () => {
          f.exit(1);
          resolve({ stdout: "", stderr: "" });
        };
      }),
  );
  let interrupted = false;
  const cancellation = Effect.runPromise(Fiber.interrupt(f.fiber)).then(() => {
    interrupted = true;
  });
  await vi.waitFor(() => expect(native.taskkill).toHaveBeenCalledOnce());
  expect(interrupted).toBe(false);
  expect(native.taskkill).toHaveBeenCalledWith(
    expect.stringMatching(/System32\\taskkill\.exe$/),
    ["/PID", "4321", "/T", "/F"],
    expect.objectContaining({ windowsHide: true, timeout: 5000 }),
  );
  finishKill();
  await cancellation;
  expect(f.job.state.status).toBe("cancelled");
  expect(f.outputDisposed).toHaveBeenCalledOnce();
  expect(f.refresh).not.toHaveBeenCalled();
});

test("retains terminal failures and releases event listeners", async () => {
  const f = await fixture();
  f.exit(3);
  await Effect.runPromise(Fiber.join(f.fiber));
  expect(f.job.state).toMatchObject({
    status: "failed",
    output: expect.stringContaining("Sign-in exited with code 3."),
  });
  expect(f.exitDisposed).toHaveBeenCalledOnce();
});

test("cancellation tolerates taskkill losing the race to ConPTY's delayed exit", async () => {
  const f = await fixture();
  native.taskkill.mockRejectedValue(new Error("Process already terminated"));
  let completed = false;
  const cancellation = Effect.runPromise(Fiber.interrupt(f.fiber)).then(() => {
    completed = true;
  });
  await vi.waitFor(() => expect(native.taskkill).toHaveBeenCalledOnce());
  expect(completed).toBe(false);
  expect(f.terminal.kill).not.toHaveBeenCalled();
  f.exit(1);
  await cancellation;
  expect(f.job.state.status).toBe("cancelled");
  expect(f.terminal.kill).not.toHaveBeenCalled();
  expect(f.outputDisposed).toHaveBeenCalledOnce();
  expect(f.exitDisposed).toHaveBeenCalledOnce();
});

test("input write failures end setup and terminate the owned process tree", async () => {
  const f = await fixture();
  f.terminal.write.mockImplementation(() => {
    throw new Error("closed terminal");
  });
  await Effect.runPromise(
    Queue.offer(f.job.input, new TextEncoder().encode("code\n")),
  );
  await Effect.runPromise(Fiber.join(f.fiber));
  expect(f.job.state).toMatchObject({
    status: "failed",
    output: expect.stringContaining("Could not send sign-in input."),
  });
  expect(native.taskkill).toHaveBeenCalledOnce();
});
