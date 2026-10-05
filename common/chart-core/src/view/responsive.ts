// Purpose: Provide mobile-responsive helpers (breakpoint collapse detection, container ResizeObserver)
// Module:  @openchart/chart-core / view

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { GridLayout } from "./layout";

export namespace Responsive {
  const MOBILE_BREAKPOINT = 768;

  export function shouldCollapse(
    width: number,
    preset: GridLayout.Preset,
  ): boolean {
    const { cols } = GridLayout.parse(preset);
    return cols > 1 && width < MOBILE_BREAKPOINT;
  }

  export function observeContainer(
    container: HTMLElement,
    onResize: (width: number, height: number) => void,
  ): ResizeObserver {
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      onResize(width, height);
    });
    ro.observe(container);
    return ro;
  }
}
