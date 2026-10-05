import { JSDOM } from "jsdom";

// Setup browser globals for tests

// Initialize JSDOM if document isn't available
if (typeof document === "undefined") {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost",
    pretendToBeVisual: true,
  });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;
}

// requestAnimationFrame / cancelAnimationFrame
let rafId = 0;
const rafCallbacks = new Map<number, FrameRequestCallback>();

globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
  const id = ++rafId;
  rafCallbacks.set(id, callback);
  setTimeout(() => {
    const cb = rafCallbacks.get(id);
    if (cb) {
      rafCallbacks.delete(id);
      cb(performance.now());
    }
  }, 16);
  return id;
}) as typeof requestAnimationFrame;

globalThis.cancelAnimationFrame = ((id: number) => {
  rafCallbacks.delete(id);
}) as typeof cancelAnimationFrame;

// window object
if (typeof globalThis.window === "undefined") {
  // @ts-expect-error - partial window mock
  globalThis.window = globalThis;
}

// Ensure window has setTimeout/clearTimeout
window.setTimeout = globalThis.setTimeout;
window.clearTimeout = globalThis.clearTimeout;

// devicePixelRatio
Object.defineProperty(globalThis, "devicePixelRatio", {
  value: 1,
  writable: true,
  configurable: true,
});

// crypto.randomUUID
if (!globalThis.crypto?.randomUUID) {
  // @ts-expect-error - partial crypto mock
  globalThis.crypto = {
    ...globalThis.crypto,
    randomUUID: () => "test-" + Math.random().toString(36).substring(2, 15),
  };
}
