// Purpose: Kinetic (momentum) scrolling and generic value animation driven by requestAnimationFrame
// Module:  @openchart/chart-core / animation

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { Easing } from "./easing";

export namespace Kinetic {
  // Velocity sample
  type Sample = {
    time: number;
    value: number;
  };

  // Kinetic scroll state
  export type State = {
    samples: Sample[];
    maxSamples: number;
    velocity: number;
    animating: boolean;
    frameId: number | null;
  };

  // Create kinetic state
  export function create(maxSamples = 5): State {
    return {
      samples: [],
      maxSamples,
      velocity: 0,
      animating: false,
      frameId: null,
    };
  }

  // Add a sample during drag
  export function sample(state: State, value: number): void {
    const now = performance.now();
    state.samples.push({ time: now, value });

    // Keep only recent samples
    while (state.samples.length > state.maxSamples) {
      state.samples.shift();
    }
  }

  // Calculate velocity from samples
  export function velocity(state: State): number {
    if (state.samples.length < 2) return 0;

    const first = state.samples[0]!;
    const last = state.samples[state.samples.length - 1]!;
    const dt = last.time - first.time;

    if (dt === 0) return 0;
    return (last.value - first.value) / dt;
  }

  // Start kinetic animation on drag end
  export function start(
    state: State,
    onUpdate: (delta: number) => void,
    onComplete?: () => void,
  ): void {
    state.velocity = velocity(state);
    state.samples = [];

    // Minimum velocity threshold
    if (Math.abs(state.velocity) < 0.01) {
      state.animating = false;
      onComplete?.();
      return;
    }

    state.animating = true;
    const startTime = performance.now();
    const startVelocity = state.velocity;
    const duration = 1500; // ms

    const animate = () => {
      if (!state.animating) return;

      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Decelerate velocity
      const decay = 1 - Easing.easeOutExpo(progress);
      const currentVelocity = startVelocity * decay;

      if (Math.abs(currentVelocity) < 0.001 || progress >= 1) {
        state.animating = false;
        state.velocity = 0;
        state.frameId = null;
        onComplete?.();
        return;
      }

      onUpdate(currentVelocity * 16); // ~16ms per frame
      state.frameId = requestAnimationFrame(animate);
    };

    state.frameId = requestAnimationFrame(animate);
  }

  // Stop kinetic animation
  export function stop(state: State): void {
    state.animating = false;
    if (state.frameId !== null) {
      cancelAnimationFrame(state.frameId);
      state.frameId = null;
    }
    state.samples = [];
    state.velocity = 0;
  }

  // Reset state
  export function reset(state: State): void {
    stop(state);
  }
}

export namespace Animation {
  // Animation state
  export type State = {
    running: boolean;
    frameId: number | null;
    startTime: number;
    duration: number;
    startValue: number;
    endValue: number;
    easing: Easing.Fn;
  };

  // Create animation
  export function create(
    startValue: number,
    endValue: number,
    duration: number,
    easing: Easing.Fn = Easing.easeOut,
  ): State {
    return {
      running: false,
      frameId: null,
      startTime: 0,
      duration,
      startValue,
      endValue,
      easing,
    };
  }

  // Start animation
  export function start(
    state: State,
    onUpdate: (value: number) => void,
    onComplete?: () => void,
  ): void {
    state.startTime = performance.now();
    state.running = true;

    const animate = () => {
      if (!state.running) return;

      const elapsed = performance.now() - state.startTime;
      const progress = Math.min(elapsed / state.duration, 1);
      const easedProgress = state.easing(progress);
      const value =
        state.startValue + (state.endValue - state.startValue) * easedProgress;

      onUpdate(value);

      if (progress >= 1) {
        state.running = false;
        state.frameId = null;
        onComplete?.();
        return;
      }

      state.frameId = requestAnimationFrame(animate);
    };

    state.frameId = requestAnimationFrame(animate);
  }

  // Stop animation
  export function stop(state: State): void {
    state.running = false;
    if (state.frameId !== null) {
      cancelAnimationFrame(state.frameId);
      state.frameId = null;
    }
  }

  // Animate a value
  export function animate(
    from: number,
    to: number,
    duration: number,
    onUpdate: (value: number) => void,
    onComplete?: () => void,
    easing: Easing.Fn = Easing.easeOut,
  ): () => void {
    const state = create(from, to, duration, easing);
    start(state, onUpdate, onComplete);
    return () => stop(state);
  }
}
