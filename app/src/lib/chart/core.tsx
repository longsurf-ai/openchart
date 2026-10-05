// Purpose: Render one canvas and provide its mounted runtime to chart children.
import {
  useLayoutEffect,
  useRef,
  type ReactNode,
  type CSSProperties,
} from "react";

import { useChartRenderer } from "@openchart/app/hooks/use-chart-renderer";

import { ChartContext } from "./context";
import type { ChartRuntime } from "./store";

/** A renderer container and its instance registration. */
export interface ChartCoreProps {
  readonly id: string;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly onReady?: (chart: ChartRuntime) => () => void;
  readonly onFocus?: () => void;
  readonly onInteractionEnd?: (chart: ChartRuntime) => void;
}

/** Own one renderer per identity and provide its runtime to children; unmount releases it. @example <ChartCore id={cell.id}><MarketSource {...input} /></ChartCore> */
export function ChartCore({
  id,
  children,
  className,
  style,
  onReady,
  onFocus,
  onInteractionEnd,
}: ChartCoreProps) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useChartRenderer(container, id);
  useLayoutEffect(() => {
    if (chart) return onReady?.(chart);
  }, [chart, onReady]);
  return (
    <section
      className={className}
      style={{
        ...style,
        position: "relative",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
      }}
      data-chart-cell={id}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
      onMouseUpCapture={() => {
        if (chart) onInteractionEnd?.(chart);
      }}
    >
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {chart ? (
        <ChartContext.Provider value={chart}>{children}</ChartContext.Provider>
      ) : null}
    </section>
  );
}
