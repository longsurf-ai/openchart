// Purpose: Easing functions (linear, quadratic, cubic, exponential, bounce) for animation curves
// Module:  @openchart/chart-core / animation

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
export namespace Easing {
  // Easing function type
  export type Fn = (t: number) => number;

  // Linear (no easing)
  export function linear(t: number): number {
    return t;
  }

  // Quadratic ease out
  export function easeOut(t: number): number {
    return 1 - (1 - t) * (1 - t);
  }

  // Quadratic ease in
  export function easeIn(t: number): number {
    return t * t;
  }

  // Quadratic ease in-out
  export function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  // Cubic ease out (smoother)
  export function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  // Cubic ease in-out
  export function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // Exponential ease out (for kinetic scrolling)
  export function easeOutExpo(t: number): number {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  // Deceleration curve (good for momentum)
  export function decelerate(t: number): number {
    return 1 - Math.pow(1 - t, 5);
  }

  // Bounce
  export function bounce(t: number): number {
    const n1 = 7.5625;
    const d1 = 2.75;

    if (t < 1 / d1) {
      return n1 * t * t;
    }
    if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75;
    }
    if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375;
    }
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }

  // Get easing function by name
  export function get(name: string): Fn {
    switch (name) {
      case "linear":
        return linear;
      case "easeOut":
        return easeOut;
      case "easeIn":
        return easeIn;
      case "easeInOut":
        return easeInOut;
      case "easeOutCubic":
        return easeOutCubic;
      case "easeInOutCubic":
        return easeInOutCubic;
      case "easeOutExpo":
        return easeOutExpo;
      case "decelerate":
        return decelerate;
      case "bounce":
        return bounce;
      default:
        return linear;
    }
  }
}
