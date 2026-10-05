// Purpose: Expose only public host information through Electron's isolated bridge.

import { contextBridge, ipcRenderer } from "electron";
import { exposeClerkBridge } from "@clerk/electron/preload";
import { z } from "zod";

const prefix = "--access-demo-port=";
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(
    process.argv
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length),
  );
const host = {
  /** Open a server-returned link through the host's Stripe URL validation. */
  openBilling: (url: string): Promise<void> =>
    ipcRenderer.invoke("billing:open", url),
  /** Subscribe to a payload-free refresh hint; it never asserts successful payment. */
  onBillingReturn: (listener: () => void): (() => void) => {
    const receive = () => listener();
    ipcRenderer.on("billing:return", receive);
    return () => ipcRenderer.removeListener("billing:return", receive);
  },
  platform: process.platform,
  publishableKey: z
    .string()
    .min(1)
    .parse(
      process.argv
        .find((value) => value.startsWith("--clerk-publishable-key="))
        ?.slice("--clerk-publishable-key=".length),
    ),
  serverURL: `http://127.0.0.1:${port}/trpc`,
};

declare global {
  interface Window {
    readonly accessDemo: Readonly<typeof host>;
  }
}

contextBridge.exposeInMainWorld("accessDemo", host);

exposeClerkBridge();
