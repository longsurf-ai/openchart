// Purpose: Proves ConPTY cleanup distinguishes delayed process exit from a surviving terminal.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { stopWindowsTerminal } from "./terminal-cleanup";

const native = vi.hoisted(() => ({ taskkill: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: native.taskkill,
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  native.taskkill.mockReset().mockResolvedValue({ stdout: "", stderr: "" });
});
afterEach(() => vi.useRealTimers());

function fixture() {
  let ended = false;
  let resolve!: () => void;
  const exit = new Promise<void>((done) => {
    resolve = done;
  });
  const finish = () => {
    ended = true;
    resolve();
  };
  const terminal = { pid: 4321, kill: vi.fn() };
  return { terminal, exit, ended: () => ended, finish };
}

test.each([false, true])(
  "awaits delayed PTY exit without reattaching the dead console (taskkill failed: %s)",
  async (failed) => {
    const f = fixture();
    if (failed)
      native.taskkill.mockRejectedValue(
        new Error("Process already terminated"),
      );
    let completed = false;
    const pending = stopWindowsTerminal(f.terminal, f.exit, f.ended).then(
      () => {
        completed = true;
      },
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(completed).toBe(false);
    expect(f.terminal.kill).not.toHaveBeenCalled();
    f.finish();
    await pending;
    expect(completed).toBe(true);
    expect(f.terminal.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);

test("falls back to PTY termination only after the bounded exit grace", async () => {
  const f = fixture();
  f.terminal.kill.mockImplementation(f.finish);
  const pending = stopWindowsTerminal(f.terminal, f.exit, f.ended);
  await vi.advanceTimersByTimeAsync(1_999);
  expect(f.terminal.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(f.terminal.kill).toHaveBeenCalledOnce();
  expect(f.ended()).toBe(true);
});

test.each([false, true])(
  "rejects a terminal that survives both cleanup attempts (taskkill failed: %s)",
  async (failed) => {
    const f = fixture();
    if (failed) native.taskkill.mockRejectedValue(new Error("Access denied"));
    const pending = stopWindowsTerminal(f.terminal, f.exit, f.ended);
    const failedCleanup = expect(pending).rejects.toThrow(
      failed ? "Could not terminate" : "did not exit",
    );
    await vi.advanceTimersByTimeAsync(4_000);
    await failedCleanup;
    expect(f.terminal.kill).toHaveBeenCalledOnce();
    expect(f.ended()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  },
);

test("never touches an already completed terminal", async () => {
  const f = fixture();
  f.finish();
  await stopWindowsTerminal(f.terminal, f.exit, f.ended);
  expect(native.taskkill).not.toHaveBeenCalled();
  expect(f.terminal.kill).not.toHaveBeenCalled();
});
