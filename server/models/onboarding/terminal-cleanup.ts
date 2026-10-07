// Purpose: Await Windows process-tree termination and ConPTY's delayed exit before releasing a setup terminal.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { IPty } from "node-pty";

const execute = promisify(execFile);

/**
 * Terminates an owned Windows login tree and awaits its existing PTY exit signal.
 * node-pty flushes output before onExit, so taskkill's completion/error alone does
 * not establish terminal cleanup. Waits two seconds before a fallback PTY kill
 * and two more afterward; a terminal that never exits rejects. A proved exit
 * tolerates taskkill racing a naturally terminating process. The caller registers
 * onExit before invoking this helper and owns listener disposal after it settles.
 * @example await stopWindowsTerminal(terminal, exit, () => ended);
 */
export async function stopWindowsTerminal(
  terminal: Pick<IPty, "pid" | "kill">,
  exit: Promise<unknown>,
  ended: () => boolean,
): Promise<void> {
  if (ended()) return;
  let treeKillFailed = false;
  try {
    await execute(
      path.win32.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "taskkill.exe",
      ),
      ["/PID", String(terminal.pid), "/T", "/F"],
      { windowsHide: true, timeout: 5_000, maxBuffer: 16_384 },
    );
  } catch {
    treeKillFailed = true;
  }
  // The native process can already be dead while ConPTY is still draining output.
  // Calling kill now asks node-pty to attach to that dead console again.
  await awaitExit(exit);
  if (ended()) return;
  let fallbackError: unknown;
  try {
    terminal.kill();
  } catch (cause) {
    fallbackError = cause;
  }
  await awaitExit(exit);
  if (ended()) return;
  if (fallbackError) throw fallbackError;
  throw new Error(
    treeKillFailed
      ? "Could not terminate terminal sign-in process tree."
      : "Terminal sign-in did not exit after termination.",
  );
}

async function awaitExit(exit: Promise<unknown>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      exit,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 2_000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
