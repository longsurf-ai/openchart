// Purpose: Render the canonical Figma trading-tool glyphs for chart drawing tools.
// Source: Figma file "Icons" (EsNWXNvjU4oWZMVnAH2xFD), page "Canonical Layer 1 - Trading Tools";
// node ids are recorded in design/icons/trading-tool-layer-1/manifest.json.
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@openchart/app/utils/cn";

/** Drawing-tool glyphs; every name maps to one Figma component node. */
export type TradingToolIconName =
  | "pencil"
  | "trendline"
  | "ray"
  | "extended-line"
  | "horizontal-line"
  | "horizontal-ray"
  | "vertical-line"
  | "cross-line"
  | "parallel-channel"
  | "rectangle"
  | "ellipse"
  | "circle"
  | "triangle"
  | "polyline"
  | "curved-line"
  | "fib-retracement"
  | "fib-extension"
  | "fib-channel"
  | "volume-profile"
  | "text";

const anchorFill = "var(--tool-icon-bg, transparent)";

function Anchor({ cx, cy }: { cx: number; cy: number }) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r="1.5"
      transform={`rotate(-45 ${cx} ${cy})`}
      fill={anchorFill}
      stroke="currentColor"
    />
  );
}

const icons: Record<TradingToolIconName, { node: string; glyph: ReactNode }> = {
  pencil: {
    node: "34:5",
    glyph: (
      <>
        <path
          d="M6.45 17.55L5.25 18.75L6.95 18.25L18.5 6.7C18.9 6.3 18.9 5.65 18.5 5.25C18.1 4.85 17.45 4.85 17.05 5.25L5.5 16.8L5.25 18.75"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15.9 6.4L17.35 7.85"
          stroke="currentColor"
          strokeLinecap="round"
        />
      </>
    ),
  },
  trendline: {
    node: "30:48",
    glyph: (
      <>
        <path d="M5 19L19 5" stroke="currentColor" strokeLinecap="round" />
        <Anchor cx={5.82843} cy={17.8284} />
        <Anchor cx={17.8284} cy={5.82843} />
      </>
    ),
  },
  ray: {
    node: "30:59",
    glyph: (
      <>
        <path d="M5 19L19 5" stroke="currentColor" strokeLinecap="round" />
        <Anchor cx={5.82843} cy={17.8284} />
        <Anchor cx={11.8284} cy={11.8284} />
      </>
    ),
  },
  "extended-line": {
    node: "30:82",
    glyph: (
      <>
        <path
          d="M4.91895 18.9199L19.3237 4.51515"
          stroke="currentColor"
          strokeLinecap="round"
        />
        <Anchor cx={8.82843} cy={14.8284} />
        <Anchor cx={14.8284} cy={8.82843} />
      </>
    ),
  },
  "horizontal-line": {
    node: "30:129",
    glyph: (
      <>
        <path d="M4 12L20 12" stroke="currentColor" strokeLinecap="round" />
        <Anchor cx={11.8284} cy={11.8284} />
      </>
    ),
  },
  "horizontal-ray": {
    node: "30:139",
    glyph: (
      <>
        <path d="M4 12L20 12" stroke="currentColor" strokeLinecap="round" />
        <Anchor cx={5.32843} cy={11.8284} />
      </>
    ),
  },
  "vertical-line": {
    node: "30:149",
    glyph: (
      <>
        <path d="M12 20L12 4" stroke="currentColor" strokeLinecap="round" />
        <Anchor cx={11.8284} cy={11.8284} />
      </>
    ),
  },
  "cross-line": {
    node: "30:160",
    glyph: (
      <>
        <path d="M4 12L20 12" stroke="currentColor" strokeLinecap="round" />
        <path d="M12 20L12 4" stroke="currentColor" strokeLinecap="round" />
        <Anchor cx={11.8284} cy={11.8284} />
      </>
    ),
  },
  "parallel-channel": {
    node: "30:106",
    glyph: (
      <>
        <path d="M3 17L17 3" stroke="currentColor" strokeLinecap="round" />
        <path d="M11 20L21 10" stroke="currentColor" strokeLinecap="round" />
        <Anchor cx={3.82843} cy={15.8284} />
        <Anchor cx={15.8284} cy={3.82843} />
        <Anchor cx={15.8284} cy={14.8284} />
      </>
    ),
  },
  // No Figma node yet: drawn in this set's style until design supplies one.
  "volume-profile": {
    node: "none",
    glyph: (
      <>
        <path d="M6.5 5V19" stroke="currentColor" strokeLinecap="round" />
        <path d="M17.5 5V19" stroke="currentColor" strokeLinecap="round" />
        <path d="M6.5 8.5H12" stroke="currentColor" />
        <path d="M6.5 12H15.5" stroke="currentColor" />
        <path d="M6.5 15.5H10" stroke="currentColor" />
        <Anchor cx={6.5} cy={5} />
        <Anchor cx={17.5} cy={19} />
      </>
    ),
  },
  rectangle: {
    node: "34:23",
    glyph: (
      <>
        <rect x="6.5" y="6.5" width="12" height="12" stroke="currentColor" />
        <Anchor cx={6.82843} cy={6.82843} />
        <Anchor cx={17.8284} cy={17.8284} />
      </>
    ),
  },
  ellipse: {
    node: "34:27",
    glyph: (
      <>
        <path
          d="M12 4.5C13.4642 4.5 14.828 5.29055 15.8428 6.64355C16.8575 7.99669 17.5 9.88875 17.5 12C17.5 14.1112 16.8575 16.0033 15.8428 17.3564C14.828 18.7094 13.4642 19.5 12 19.5C10.5358 19.5 9.17198 18.7094 8.15723 17.3564C7.1425 16.0033 6.5 14.1112 6.5 12C6.5 9.88875 7.1425 7.99669 8.15723 6.64355C9.17198 5.29055 10.5358 4.5 12 4.5Z"
          stroke="currentColor"
        />
        <Anchor cx={17.8284} cy={11.8284} />
        <path
          d="M10.7678 3.76777C11.3536 3.18198 12.3033 3.18198 12.8891 3.76777C13.4749 4.35356 13.4749 5.3033 12.8891 5.88909C12.3033 6.47488 11.3536 6.47488 10.7678 5.88909C10.182 5.3033 10.182 4.35356 10.7678 3.76777Z"
          fill={anchorFill}
          stroke="currentColor"
        />
        <path
          d="M10.7678 17.7678C11.3536 17.182 12.3033 17.182 12.8891 17.7678C13.4749 18.3536 13.4749 19.3033 12.8891 19.8891C12.3033 20.4749 11.3536 20.4749 10.7678 19.8891C10.182 19.3033 10.182 18.3536 10.7678 17.7678Z"
          fill={anchorFill}
          stroke="currentColor"
        />
      </>
    ),
  },
  circle: {
    node: "local:circle",
    glyph: (
      <>
        <circle cx="12" cy="12" r="6.5" stroke="currentColor" />
        <Anchor cx={16.8284} cy={7.82843} />
        <path
          d="M10.7678 10.7678C11.3536 10.182 12.3033 10.182 12.8891 10.7678C13.4749 11.3536 13.4749 12.3033 12.8891 12.8891C12.3033 13.4749 11.3536 13.4749 10.7678 12.8891C10.182 12.3033 10.182 11.3536 10.7678 10.7678Z"
          fill={anchorFill}
          stroke="currentColor"
        />
      </>
    ),
  },
  triangle: {
    node: "local:triangle",
    glyph: (
      <>
        <path
          d="M17.7458 12.2448L7.99457 17.8747L7.9947 6.61518L17.7458 12.2448Z"
          stroke="currentColor"
        />
        <Anchor cx={7.82843} cy={6.82843} />
        <Anchor cx={7.82843} cy={17.8284} />
        <Anchor cx={17.8284} cy={12.3284} />
      </>
    ),
  },
  polyline: {
    node: "local:polyline",
    glyph: (
      <>
        <path
          d="M5 18L8.27639 11.4472C8.39989 11.2002 8.70022 11.1001 8.94721 11.2236L15.0741 14.287C15.3126 14.4063 15.6027 14.3174 15.7335 14.085L20 6.5"
          stroke="currentColor"
          strokeLinecap="round"
        />
        <path
          d="M3.76777 16.7678C4.35355 16.182 5.3033 16.182 5.88909 16.7678C6.47487 17.3536 6.47487 18.3033 5.88909 18.8891C5.3033 19.4749 4.35355 19.4749 3.76777 18.8891C3.18198 18.3033 3.18198 17.3536 3.76777 16.7678Z"
          fill={anchorFill}
          stroke="currentColor"
        />
        <Anchor cx={15.8284} cy={13.8284} />
        <Anchor cx={19.8284} cy={6.82843} />
        <Anchor cx={8.82843} cy={10.8284} />
      </>
    ),
  },
  "curved-line": {
    node: "local:curved-line",
    glyph: (
      <>
        <path
          d="M5 18C5 18 9.97434 18 14.5 14.5C17.3731 12.278 20 7 20 7"
          stroke="currentColor"
          strokeLinecap="round"
        />
        <path
          d="M3.76777 16.7678C4.35355 16.182 5.3033 16.182 5.88909 16.7678C6.47487 17.3536 6.47487 18.3033 5.88909 18.8891C5.3033 19.4749 4.35355 19.4749 3.76777 18.8891C3.18198 18.3033 3.18198 17.3536 3.76777 16.7678Z"
          fill={anchorFill}
          stroke="currentColor"
        />
        <Anchor cx={19.8284} cy={6.82843} />
        <Anchor cx={13.8284} cy={14.8284} />
      </>
    ),
  },
  "fib-retracement": {
    node: "34:33",
    glyph: (
      <>
        <path d="M5 6h14" stroke="currentColor" strokeLinecap="round" />
        <path d="M5 10h14" stroke="currentColor" strokeLinecap="round" />
        <path d="M5 14h14" stroke="currentColor" strokeLinecap="round" />
        <path d="M5 18h14" stroke="currentColor" strokeLinecap="round" />
        <Anchor cx={18.8284} cy={9.82843} />
        <Anchor cx={4.82843} cy={17.8284} />
      </>
    ),
  },
  "fib-extension": {
    node: "34:39",
    glyph: (
      <>
        <path
          d="M4.82843 11.4069V9.04553C4.82843 8.57477 5.15677 8.16775 5.61687 8.06816L15.1716 6"
          stroke="currentColor"
          strokeLinecap="round"
        />
        <path d="M5 13h14" stroke="currentColor" strokeLinecap="round" />
        <path d="M5 16h14" stroke="currentColor" strokeLinecap="round" />
        <path d="M5 19h14" stroke="currentColor" strokeLinecap="round" />
        <path
          d="M16.032 4.28248C16.6178 3.69669 17.5675 3.69669 18.1533 4.28248C18.7391 4.86827 18.7391 5.81801 18.1533 6.4038C17.5675 6.98959 16.6178 6.98959 16.032 6.4038C15.4462 5.81801 15.4462 4.86827 16.032 4.28248Z"
          fill={anchorFill}
          stroke="currentColor"
        />
        <Anchor cx={4.82843} cy={8.17157} />
        <Anchor cx={4.82843} cy={12.8284} />
      </>
    ),
  },
  "fib-channel": {
    node: "34:43",
    glyph: (
      <>
        <path
          d="M5.96143 12L18.0858 5"
          stroke="currentColor"
          strokeLinecap="round"
        />
        <path
          d="M5.96143 16L18.0858 9"
          stroke="currentColor"
          strokeLinecap="round"
        />
        <path
          d="M5.96143 20L18.0858 13"
          stroke="currentColor"
          strokeLinecap="round"
        />
        <Anchor cx={18.0858} cy={5} />
        <Anchor cx={5.91421} cy={11.3284} />
        <Anchor cx={5.91421} cy={15.6716} />
      </>
    ),
  },
  text: {
    node: "34:49",
    glyph: (
      <>
        <path
          d="M14.5 21H9.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12 3V21"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M5 5.5V4C5 3.44772 5.44772 3 6 3H18C18.5523 3 19 3.44772 19 4V5.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
};

/**
 * Render one hand-drawn trading-tool glyph in the surrounding text color.
 * Anchor dots fill with `--tool-icon-bg` so the containing surface can mask the line beneath them.
 * @example
 * <TradingToolIcon name="trendline" className="size-5" />
 */
export function TradingToolIcon({
  name,
  className,
  ...props
}: { name: TradingToolIconName } & Omit<ComponentProps<"svg">, "children">) {
  const icon = icons[name];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1}
      aria-hidden="true"
      focusable="false"
      data-figma-component-node={icon.node}
      className={cn("size-5 shrink-0 overflow-visible", className)}
      {...props}
    >
      {icon.glyph}
    </svg>
  );
}
