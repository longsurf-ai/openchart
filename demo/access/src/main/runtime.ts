// Purpose: Supervise the access demo's independent backend utility process.

import { once } from "node:events";
import { utilityProcess } from "electron";
import { z } from "zod";
import { executeHostRequest } from "./host";
import { HostRequest } from "./host-protocol";
import serverPath from "./server?modulePath";

/** Ready backend endpoint and its process-owned cleanup. */
export interface DemoRuntime {
  readonly port: number;
  /** Stop HTTP and the server runtime before the child exits. @example await runtime.stop(); */
  readonly stop: () => Promise<void>;
}

/**
 * Start one backend and await its listening port. Startup failure kills the child;
 * unexpected exit after readiness is reported to the Electron host. The host must
 * call stop() at application exit, including exit while startup is pending.
 * @example const runtime = await startRuntime(home, rendererOrigin, fail);
 */
export async function startRuntime(
  home: string,
  rendererOrigin: string,
  onFailure: (cause: Error) => void,
  billingUrl?: string,
): Promise<DemoRuntime> {
  const child = utilityProcess.fork(
    serverPath,
    [home, rendererOrigin, billingUrl ?? ""],
    {
      serviceName: "OpenChart Access Demo Server",
      stdio: "inherit",
    },
  );
  const exited = once(child, "exit");
  const ready = new Promise<number>((resolve, reject) => {
    child.on("message", (message: unknown) => {
      if (typeof message === "number") {
        resolve(z.number().int().min(1).max(65535).parse(message));
        return;
      }
      const request = HostRequest.safeParse(message);
      if (!request.success) {
        reject(new Error("Unexpected backend message"));
        return;
      }
      void executeHostRequest(request.data).then(
        (value) =>
          child.postMessage({
            type: "host-result",
            id: request.data.id,
            value,
          }),
        () => child.postMessage({ type: "host-error", id: request.data.id }),
      );
    });
  });
  let port: number;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const message = await Promise.race([
      ready,
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Demo server startup timed out")),
          30_000,
        );
      }),
      exited.then(([code]) => {
        throw new Error(`Demo server exited during startup (${code})`);
      }),
    ]);
    port = z.number().int().min(1).max(65535).parse(message);
  } catch (cause) {
    child.kill();
    throw cause;
  } finally {
    clearTimeout(deadline);
  }

  let stopping = false;
  void exited.then(([code]) => {
    if (!stopping)
      onFailure(new Error(`Demo server exited unexpectedly (${code})`));
  });

  return {
    port,
    async stop() {
      stopping = true;
      child.postMessage("shutdown");
      const deadline = setTimeout(() => child.kill(), 5000);
      try {
        await exited;
      } finally {
        clearTimeout(deadline);
      }
    },
  };
}
