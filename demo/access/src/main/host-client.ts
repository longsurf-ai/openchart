// Purpose: Give the utility-process backend narrow native capabilities over its private parent channel.
import { HostResponse, type HostRequest } from "./host-protocol";
import type { z } from "zod";

const pending = new Map<
  number,
  { resolve: (value: string) => void; reject: (error: Error) => void }
>();
let nextID = 0;
process.parentPort.on("message", ({ data }: { data: unknown }) => {
  if (data === "shutdown") return;
  const response = HostResponse.parse(data);
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  if (response.type === "host-result") request.resolve(response.value);
  else request.reject(new Error("Native host operation failed"));
});

/** Invoke native encryption without exposing the utility-process channel to the renderer. @example await hostRequest('encrypt', value); */
export function hostRequest(
  operation: z.infer<typeof HostRequest>["operation"],
  value: string,
): Promise<string> {
  const id = ++nextID;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    process.parentPort.postMessage({
      type: "host-request",
      id,
      operation,
      value,
    });
  });
}
