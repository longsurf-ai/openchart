// Purpose: Verify trusted native callbacks settle OAuth attempts and allow immediate retries.
import { EventEmitter } from "node:events";
import type { IpcMainInvokeEvent } from "electron";
import { afterEach, expect, test, vi } from "vitest";

type IpcHandler = (event: IpcMainInvokeEvent, ...args: string[]) => unknown;

let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function transport(oauthRedirectUrl?: string) {
  vi.resetModules();
  const handlers = new Map<string, IpcHandler>();
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    hasSingleInstanceLock: () => true,
    setAsDefaultProtocolClient: vi.fn(),
  });
  const openExternal = vi.fn(async () => {});
  vi.doMock("electron", () => ({
    app,
    BrowserWindow: { fromWebContents: () => null },
    ipcMain: {
      handle: (name: string, handler: IpcHandler) =>
        handlers.set(name, handler),
      removeHandler: (name: string) => handlers.delete(name),
    },
    protocol: { registerSchemesAsPrivileged: vi.fn() },
    shell: { openExternal },
  }));
  const { createClerkBridge } = await import("@clerk/electron");
  const bridge = createClerkBridge({
    renderer: { scheme: "openchart-dev", host: "app" },
    storage: {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    },
    oauthRedirectUrl,
  });
  cleanup = bridge.cleanup;
  const mainFrame = {};
  const event = {
    sender: { getType: () => "window", mainFrame },
    senderFrame: mainFrame,
  } as IpcMainInvokeEvent;
  const invoke = (operation: string, ...args: string[]) => {
    const handler = handlers.get(`clerk:oauth-transport:${operation}`);
    if (!handler) throw new Error(`Missing OAuth handler: ${operation}`);
    return handler(event, ...args);
  };
  return { app, invoke, openExternal };
}

test("HTTPS browser return retains exact native callback matching", async () => {
  const returnUrl = "https://longsurf.ai/auth/return/?app=development";
  const { app, invoke, openExternal } = await transport(returnUrl);
  expect(invoke("get-redirect-url")).toBe(returnUrl);
  const pending = invoke("open", "https://accounts.example.com/sign-in");
  expect(openExternal).toHaveBeenCalledWith(
    "https://accounts.example.com/sign-in",
  );
  for (const invalid of [
    returnUrl,
    "openchart://app/",
    "openchart-dev://other/",
    "openchart-dev://app/other",
  ]) {
    const preventDefault = vi.fn();
    app.emit("open-url", { preventDefault }, invalid);
    expect(preventDefault).not.toHaveBeenCalled();
  }
  const callbackUrl = "openchart-dev://app/?rotating_token_nonce=one-time";
  app.emit("open-url", { preventDefault: vi.fn() }, callbackUrl);
  await expect(pending).resolves.toEqual({ callbackUrl });
});

test("omitting the override retains the SDK native redirect", async () => {
  const { invoke } = await transport();
  expect(invoke("get-redirect-url")).toBe("openchart-dev://app/");
});

// Clerk sends no fields when no session was created: a cancellation, or a new
// account the SDK transfers to sign-up. Either way the attempt must settle.
test.each([
  "openchart-dev://app/?__clerk_status=failed",
  "openchart-dev://app/",
])(
  "callback %s releases the pending flow and its timer before retry",
  async (callbackUrl) => {
    vi.useFakeTimers();
    const { app, invoke, openExternal } = await transport();
    const cancelled = invoke("open", "https://accounts.example.com/sign-in");
    app.emit("open-url", { preventDefault: vi.fn() }, callbackUrl);
    await expect(cancelled).resolves.toEqual({ callbackUrl });
    expect(vi.getTimerCount()).toBe(0);

    // A retry starts immediately, without waiting for the old three-minute timeout.
    await vi.advanceTimersByTimeAsync(1_000);
    const retry = invoke("open", "https://accounts.example.com/sign-in");
    expect(openExternal).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(179_000);
    const retryCallback = "openchart-dev://app/?rotating_token_nonce=retry";
    app.emit("open-url", { preventDefault: vi.fn() }, retryCallback);
    await expect(retry).resolves.toEqual({ callbackUrl: retryCallback });
    expect(vi.getTimerCount()).toBe(0);
  },
);

test("browser redirect overrides require HTTPS", async () => {
  await expect(transport("http://longsurf.ai/auth/return/")).rejects.toThrow(
    "HTTPS",
  );
});
