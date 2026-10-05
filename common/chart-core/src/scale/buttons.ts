// Purpose: Auto-scale / log toggle buttons — layout, hit-testing, rendering, and state toggling for y-axis controls
// Module:  @openchart/chart-core / scale

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { ChartConfig } from "@openchart/chart-core/config";
import type { Chart } from "@openchart/chart-core/chart/state";
import type { YAxisConfig } from "./config";

type Axis = YAxisConfig.Axis;

export namespace ScaleButtons {
  export type ButtonType = "auto" | "log" | "menu";

  export type Button = {
    type: ButtonType;
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
  };

  export type Layout = {
    buttons: Button[];
  };

  const BTN_WIDTH = 18;
  const BTN_HEIGHT = 16;
  const BTN_RADIUS = 4;
  const SPACING = 4;
  const BOTTOM_PADDING = 6;
  const CLUSTER_PADDING = 3;

  // Compute button positions for a scale axis (A/L on bottom row, menu below).
  export function layout(bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Layout {
    const rowWidth = BTN_WIDTH * 2 + SPACING;
    const totalHeight = BTN_HEIGHT * 2 + SPACING;
    const rowX = bounds.x + (bounds.width - rowWidth) / 2;
    const menuX = bounds.x + (bounds.width - BTN_WIDTH) / 2;
    const startY = bounds.y + bounds.height - totalHeight - BOTTOM_PADDING;

    const buttons: Button[] = [
      {
        type: "auto",
        x: rowX,
        y: startY,
        width: BTN_WIDTH,
        height: BTN_HEIGHT,
        label: "A",
      },
      {
        type: "log",
        x: rowX + BTN_WIDTH + SPACING,
        y: startY,
        width: BTN_WIDTH,
        height: BTN_HEIGHT,
        label: "L",
      },
      {
        type: "menu",
        x: menuX,
        y: startY + BTN_HEIGHT + SPACING,
        width: BTN_WIDTH,
        height: BTN_HEIGHT,
        label: "⋯",
      },
    ];

    return { buttons };
  }

  // Test if point hits a button
  export function hitTest(
    x: number,
    y: number,
    bounds: { x: number; y: number; width: number; height: number },
  ): ButtonType | null {
    // Quick bounds check
    if (x < bounds.x || x > bounds.x + bounds.width) return null;
    if (y < bounds.y || y > bounds.y + bounds.height) return null;

    const btns = layout(bounds).buttons;
    for (const btn of btns) {
      if (
        x >= btn.x &&
        x <= btn.x + btn.width &&
        y >= btn.y &&
        y <= btn.y + btn.height
      ) {
        return btn.type;
      }
    }

    return null;
  }

  // Draw a rounded rectangle path
  function roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function clusterBounds(buttons: Button[]): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const minX = Math.min(...buttons.map((button) => button.x));
    const minY = Math.min(...buttons.map((button) => button.y));
    const maxX = Math.max(...buttons.map((button) => button.x + button.width));
    const maxY = Math.max(...buttons.map((button) => button.y + button.height));
    return {
      x: minX - CLUSTER_PADDING,
      y: minY - CLUSTER_PADDING,
      width: maxX - minX + CLUSTER_PADDING * 2,
      height: maxY - minY + CLUSTER_PADDING * 2,
    };
  }

  // Render buttons on canvas (only when hovered)
  export function render(
    ctx: CanvasRenderingContext2D,
    scale: { autoScale: boolean; mode: string },
    bounds: { x: number; y: number; width: number; height: number },
    hovered: boolean,
    options?: {
      backdropColor?: string;
    },
  ): void {
    if (!hovered) return;

    const btns = layout(bounds).buttons;
    const backdrop = clusterBounds(btns);

    ctx.save();
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    roundedRect(
      ctx,
      backdrop.x,
      backdrop.y,
      backdrop.width,
      backdrop.height,
      BTN_RADIUS + 2,
    );
    ctx.fillStyle = options?.backdropColor ?? "#ffffff";
    ctx.fill();

    for (const btn of btns) {
      const active = isActive(btn.type, scale);

      roundedRect(ctx, btn.x, btn.y, btn.width, btn.height, BTN_RADIUS);

      if (active) {
        ctx.fillStyle = "#2962FF";
        ctx.fill();
        ctx.fillStyle = "#ffffff";
      } else {
        ctx.strokeStyle = "#758696";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#758696";
      }

      ctx.fillText(btn.label, btn.x + btn.width / 2, btn.y + btn.height / 2);
    }

    ctx.restore();
  }

  // Check if a button should be active
  function isActive(
    type: ButtonType,
    scale: { autoScale: boolean; mode: string },
  ): boolean {
    if (type === "auto") return scale.autoScale;
    if (type === "log") return scale.mode === "logarithmic";
    return false;
  }

  // Toggle a scale option
  export function toggle(
    scale: {
      autoScale: boolean;
      mode: string;
      visibleExtent?: { min: number; max: number };
    },
    type: ButtonType,
    extent: { min: number; max: number },
  ): void {
    if (type === "auto") {
      if (scale.autoScale) {
        scale.autoScale = false;
        scale.visibleExtent = extent;
      } else {
        scale.autoScale = true;
        scale.visibleExtent = undefined;
      }
      return;
    }

    if (type === "log") {
      scale.mode = scale.mode === "logarithmic" ? "normal" : "logarithmic";
    }
  }

  export function toggleAxis(
    entry: { state: Chart.State },
    axisId: string,
    type: ButtonType,
    extent: { min: number; max: number },
  ): void {
    const axes = entry.state.config.yAxis.axes as Axis[];
    const idx = axes.findIndex((a) => a.id === axisId);
    if (idx < 0) return;

    const axis = axes[idx]!;
    const updated = [...axes];

    if (type === "auto") {
      if (axis.autoScale) {
        updated[idx] = { ...axis, autoScale: false, visibleExtent: extent };
      } else {
        updated[idx] = { ...axis, autoScale: true, visibleExtent: undefined };
      }
    } else if (type === "log") {
      const newMode = axis.mode === "logarithmic" ? "normal" : "logarithmic";
      updated[idx] = { ...axis, mode: newMode };
    } else if (type === "menu") {
      return;
    }

    entry.state.config = ChartConfig.set(
      entry.state.config,
      "yAxis.axes",
      updated,
    );
  }

  export function toggleAxisMutate(
    axes: Axis[],
    axisId: string,
    type: ButtonType,
    extent: { min: number; max: number },
  ): void {
    const idx = axes.findIndex((a) => a.id === axisId);
    if (idx < 0) return;

    const axis = axes[idx]!;

    if (type === "auto") {
      if (axis.autoScale) {
        axes[idx] = { ...axis, autoScale: false, visibleExtent: extent };
      } else {
        axes[idx] = { ...axis, autoScale: true, visibleExtent: undefined };
      }
    } else if (type === "log") {
      const newMode = axis.mode === "logarithmic" ? "normal" : "logarithmic";
      axes[idx] = { ...axis, mode: newMode };
    } else if (type === "menu") {
      return;
    }
  }
}
