// Purpose: Render placements and translate pointer or keyboard layout edits into Dashboard saves.
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import GridLayout, {
  verticalCompactor,
  type Layout,
  type useContainerWidth,
} from "react-grid-layout";

import {
  dashboardRows,
  editWidgetLayout,
  placeWidgets,
  widgetLayout,
} from "@openchart/app/features/dashboard/utils/layout";
import type { Dashboard } from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { cn } from "@openchart/app/utils/cn";

import { WidgetHost } from "./widget-host";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";
import "react-grid-layout/css/styles.css";
import "./dashboard.css";

/** Keep gesture geometry local to RGL; save all affected placements against the original snapshot. @example <DashboardGrid {...gridProps} /> */
export function DashboardGrid({
  dashboard,
  registry,
  transport,
  container,
  disabled,
  resetKey,
  onSave,
  onPlaceBeside,
}: {
  dashboard: Dashboard | undefined;
  registry: Readonly<Record<string, WidgetDefinition | undefined>>;
  transport: AppTransport;
  container: ReturnType<typeof useContainerWidth>;
  disabled: boolean;
  resetKey: number;
  onSave: (
    snapshot: Dashboard,
    widgets: Dashboard["widgets"],
  ) => Promise<Dashboard>;
  onPlaceBeside: (
    anchorId: string,
    definition: WidgetDefinition,
    resourceId?: string,
  ) => string;
}) {
  const { width, mounted, containerRef } = container;
  const narrow = width < 640;
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.height > 0)
        setHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef]);
  const gesture = useRef<Dashboard>();
  const layout = useMemo(
    () => widgetLayout(dashboard?.widgets ?? [], registry),
    [dashboard?.widgets, registry],
  );
  const displayed = useMemo(
    () =>
      narrow
        ? verticalCompactor.compact(
            layout.map((item, index) => ({
              ...item,
              x: 0,
              y: index,
              w: 1,
              minW: 1,
              maxW: 1,
            })),
            1,
          )
        : layout,
    [layout, narrow],
  );
  const commitLayout = (next: Layout, snapshot: Dashboard) => {
    const widgets = placeWidgets(snapshot.widgets, next);
    if (
      widgets.every((widget, index) => {
        const before = snapshot.widgets[index]!.layout;
        return (["x", "y", "w", "h"] as const).every(
          (field) => before[field] === widget.layout[field],
        );
      })
    )
      return Promise.resolve(snapshot);
    return onSave(snapshot, widgets);
  };
  const stop = (next: Layout) => {
    const snapshot = gesture.current;
    gesture.current = undefined;
    if (snapshot) void commitLayout(next, snapshot).catch(() => undefined);
  };
  return (
    <div
      role={dashboard ? "region" : undefined}
      aria-label={dashboard ? "Dashboard grid" : undefined}
      className={cn("min-h-0 px-3 pb-3", narrow ? "shrink-0 grow" : "flex-1")}
      ref={containerRef as RefObject<HTMLDivElement>}
    >
      {dashboard && !dashboard.widgets.length ? (
        <section className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <h2 className="font-studio text-2xl font-medium">
            Add a widget to this dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            Open Widgets to add a chart or workspace.
          </p>
        </section>
      ) : null}
      {dashboard &&
      mounted &&
      (narrow || height > 0) &&
      dashboard.widgets.length ? (
        <GridLayout
          key={resetKey}
          className="dashboard-grid"
          width={width}
          layout={displayed}
          autoSize={narrow}
          style={narrow ? undefined : { height }}
          gridConfig={{
            cols: narrow ? 1 : 12,
            rowHeight: narrow
              ? 24
              : Math.max(1, (height - 8 * (dashboardRows - 1)) / dashboardRows),
            maxRows: narrow ? Infinity : dashboardRows,
            margin: [8, 8],
            containerPadding: [0, 0],
          }}
          compactor={verticalCompactor}
          dragConfig={{
            enabled: !narrow && !disabled,
            bounded: !narrow,
            handle: "[data-widget-drag-handle]",
          }}
          resizeConfig={{
            enabled: !narrow && !disabled,
            handles: ["se"],
          }}
          onDragStart={() => {
            gesture.current = dashboard;
          }}
          onResizeStart={() => {
            gesture.current = dashboard;
          }}
          onDragStop={stop}
          onResizeStop={stop}
        >
          {dashboard.widgets.map((placement) => (
            <div key={placement.id}>
              <WidgetHost
                placement={placement}
                dashboardId={dashboard.id}
                transport={transport}
                definition={registry[placement.kind]}
                disabled={disabled}
                onPlaceBeside={onPlaceBeside}
                onRemove={() =>
                  void onSave(
                    dashboard,
                    dashboard.widgets.filter(
                      (widget) => widget.id !== placement.id,
                    ),
                  ).catch(() => undefined)
                }
                onLayout={
                  narrow
                    ? undefined
                    : (rectangle) =>
                        commitLayout(
                          editWidgetLayout(layout, placement.id, rectangle),
                          dashboard,
                        )
                }
              />
            </div>
          ))}
        </GridLayout>
      ) : null}
    </div>
  );
}
