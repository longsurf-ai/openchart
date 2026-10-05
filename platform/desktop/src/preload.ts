// Purpose: Expose the backend connection, native folder picker and update restart through guarded main IPC.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { exposeClerkBridge } from "@clerk/electron/preload";

exposeClerkBridge();

// Electron runs this before page scripts. Expose only these narrow host operations.
contextBridge.exposeInMainWorld("desktop", {
  /** Asks main for the address and secret; main checks which page is asking. */
  connection: () => ipcRenderer.invoke("desktop.connection"),
  /** Opens main's native single-folder picker. */
  pickDirectory: () => ipcRenderer.invoke("desktop.pickDirectory"),
  /** Opens a local file with the system's default application. */
  openPath: (path: string) => ipcRenderer.invoke("desktop.openPath", path),
  /** Opens a validated Stripe Checkout or Portal link. */
  openBilling: (url: string) => ipcRenderer.invoke("desktop.openBilling", url),
  /** Billing returns contain no status or account data; consumers query the backend. */
  onBillingReturn: (listener: () => void) => {
    let active = true;
    const receive = () => listener();
    ipcRenderer.on("desktop.billingReturn", receive);
    void ipcRenderer
      .invoke("desktop.billingReturn")
      .then((pending: boolean) => {
        if (pending && active) listener();
      });
    return () => {
      active = false;
      ipcRenderer.removeListener("desktop.billingReturn", receive);
    };
  },
  /** Reports a downloaded update, including one that finished before this page loaded. */
  onUpdateReady: (listener: (release: string) => void) => {
    const receive = (_event: IpcRendererEvent, release: string) =>
      listener(release);
    ipcRenderer.on("desktop.updateReady", receive);
    void ipcRenderer
      .invoke("desktop.updateReady")
      .then((release: string | null) => {
        if (release) listener(release);
      });
    return () => {
      ipcRenderer.removeListener("desktop.updateReady", receive);
    };
  },
  /** Asks main to quit normally and install the downloaded update. */
  restartToUpdate: () => ipcRenderer.invoke("desktop.restartToUpdate"),
});
