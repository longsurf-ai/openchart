// Purpose: DOM event helpers — coordinate extraction, touch/mouse point conversion, wheel speed normalization
// Module:  @openchart/chart-core / interaction

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { Action } from "./action";

// Detect Windows Chrome for scroll speed bug workaround
// https://bugs.chromium.org/p/chromium/issues/detail?id=1001735
const isWindowsChrome =
  typeof navigator !== "undefined" &&
  navigator.userAgent.includes("Windows") &&
  navigator.userAgent.includes("Chrome");

export namespace Input {
  export function wheelSpeed(mode: number): number {
    // DOM_DELTA_PAGE = 2, DOM_DELTA_LINE = 1, DOM_DELTA_PIXEL = 0
    if (mode === 2) return 120;
    if (mode === 1) return 32;
    if (!isWindowsChrome) return 1;
    return 1 / (window.devicePixelRatio || 1);
  }

  export function point(e: MouseEvent, rect: DOMRect): Action.Point {
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  export function touchPoint(t: Touch, rect: DOMRect): Action.Point {
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  export function distance(p1: Action.Point, p2: Action.Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  export function midpoint(p1: Action.Point, p2: Action.Point): Action.Point {
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  }
}
