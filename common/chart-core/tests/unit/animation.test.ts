// Purpose: Tests for easing functions, kinetic scrolling, and value animation
// Module:  @openchart/chart-core / tests / unit

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Easing, Kinetic, Animation } from "@openchart/chart-core/animation";

// Polyfill requestAnimationFrame/cancelAnimationFrame for non-browser test environments
if (typeof globalThis.requestAnimationFrame === "undefined") {
  let _rafId = 0;
  const _rafCallbacks = new Map<number, ReturnType<typeof setTimeout>>();
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = ++_rafId;
    _rafCallbacks.set(
      id,
      setTimeout(() => {
        _rafCallbacks.delete(id);
        cb(performance.now());
      }, 16),
    );
    return id;
  };
  globalThis.cancelAnimationFrame = (id: number): void => {
    const handle = _rafCallbacks.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      _rafCallbacks.delete(id);
    }
  };
}

describe("Easing", () => {
  describe("linear", () => {
    it("returns input unchanged", () => {
      expect(Easing.linear(0)).toBe(0);
      expect(Easing.linear(0.5)).toBe(0.5);
      expect(Easing.linear(1)).toBe(1);
    });
  });

  describe("easeOut", () => {
    it("starts fast and slows down", () => {
      const early = Easing.easeOut(0.2);
      const late = Easing.easeOut(0.8);

      // Early progress should be more than linear
      expect(early).toBeGreaterThan(0.2);
      // Late progress should be less than linear progress from that point
      expect(1 - late).toBeLessThan(0.2);
    });

    it("returns 0 at start", () => {
      expect(Easing.easeOut(0)).toBe(0);
    });

    it("returns 1 at end", () => {
      expect(Easing.easeOut(1)).toBe(1);
    });
  });

  describe("easeInOut", () => {
    it("has symmetric curve", () => {
      const earlyRate = Easing.easeInOut(0.25);
      const lateRate = 1 - Easing.easeInOut(0.75);
      expect(earlyRate).toBeCloseTo(lateRate, 5);
    });

    it("reaches 0.5 at midpoint", () => {
      expect(Easing.easeInOut(0.5)).toBe(0.5);
    });
  });

  describe("easeOutExpo", () => {
    it("has exponential decay", () => {
      expect(Easing.easeOutExpo(0)).toBe(0);
      expect(Easing.easeOutExpo(1)).toBe(1);
      expect(Easing.easeOutExpo(0.5)).toBeGreaterThan(0.9);
    });
  });

  describe("easeOutCubic", () => {
    it("is cubic function", () => {
      expect(Easing.easeOutCubic(0)).toBe(0);
      expect(Easing.easeOutCubic(1)).toBe(1);
      expect(Easing.easeOutCubic(0.5)).toBeCloseTo(0.875, 3);
    });
  });
});

describe("Kinetic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("create", () => {
    it("creates kinetic state", () => {
      const state = Kinetic.create();
      expect(state).toBeDefined();
    });
  });

  describe("sample", () => {
    it("records sample", () => {
      const state = Kinetic.create();
      Kinetic.sample(state, 100);
      expect(state.samples.length).toBeGreaterThan(0);
    });

    it("tracks multiple samples", () => {
      const state = Kinetic.create();
      Kinetic.sample(state, 100);
      vi.advanceTimersByTime(16);
      Kinetic.sample(state, 110);
      vi.advanceTimersByTime(16);
      Kinetic.sample(state, 120);
      expect(state.samples.length).toBe(3);
    });

    it("limits sample history", () => {
      const state = Kinetic.create();
      for (let i = 0; i < 20; i++) {
        Kinetic.sample(state, i * 10);
        vi.advanceTimersByTime(16);
      }
      expect(state.samples.length).toBeLessThanOrEqual(10);
    });
  });

  describe("velocity", () => {
    it("calculates velocity from samples", () => {
      const state = Kinetic.create();
      Kinetic.sample(state, 0);
      vi.advanceTimersByTime(100);
      Kinetic.sample(state, 100);

      const v = Kinetic.velocity(state);
      // 100 units in 100ms = 1 unit per ms
      expect(v).toBeCloseTo(1, 0);
    });

    it("returns 0 with no samples", () => {
      const state = Kinetic.create();
      expect(Kinetic.velocity(state)).toBe(0);
    });

    it("returns 0 with single sample", () => {
      const state = Kinetic.create();
      Kinetic.sample(state, 100);
      expect(Kinetic.velocity(state)).toBe(0);
    });
  });

  describe("start", () => {
    it("calls onUpdate with delta", () => {
      const state = Kinetic.create();
      Kinetic.sample(state, 0);
      vi.advanceTimersByTime(16);
      Kinetic.sample(state, 100);

      const updates: number[] = [];
      Kinetic.start(state, (delta) => {
        updates.push(delta);
      });

      vi.advanceTimersByTime(16);
      expect(updates.length).toBeGreaterThan(0);
    });

    it("calls onComplete when stopped", () => {
      const state = Kinetic.create();
      const onComplete = vi.fn();
      Kinetic.sample(state, 0);
      vi.advanceTimersByTime(16);
      Kinetic.sample(state, 10);

      Kinetic.start(state, () => {}, onComplete);

      // Advance enough for animation to complete
      vi.advanceTimersByTime(2000);
      expect(onComplete).toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("stops animation", () => {
      const state = Kinetic.create();
      Kinetic.sample(state, 0);
      vi.advanceTimersByTime(16);
      Kinetic.sample(state, 100);

      let callCount = 0;
      Kinetic.start(state, () => {
        callCount++;
      });

      vi.advanceTimersByTime(16);
      const countAfterStart = callCount;

      Kinetic.stop(state);
      vi.advanceTimersByTime(100);

      expect(callCount).toBe(countAfterStart);
    });
  });
});

describe("Animation", () => {
  describe("create", () => {
    it("creates animation state", () => {
      const state = Animation.create(0, 100, 1000);
      expect(state.running).toBe(false);
      expect(state.startValue).toBe(0);
      expect(state.endValue).toBe(100);
      expect(state.duration).toBe(1000);
    });

    it("accepts custom easing", () => {
      const state = Animation.create(0, 100, 1000, Easing.linear);
      expect(state.easing).toBe(Easing.linear);
    });
  });

  describe("animate helper", () => {
    it("returns stop function", () => {
      const stop = Animation.animate(0, 100, 1000, () => {});
      expect(typeof stop).toBe("function");
      stop();
    });
  });

  describe("stop", () => {
    it("stops animation", () => {
      const state = Animation.create(0, 100, 1000);
      Animation.stop(state);
      expect(state.running).toBe(false);
    });
  });
});
