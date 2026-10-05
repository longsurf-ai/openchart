// Purpose: Mount one Dashboard placement using a shared card and independently owned feature components.
import { GripVertical, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useMemo, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { Button } from "@openchart/app/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import { WidgetCard, WidgetControls } from "./widget-card";
import {
  dashboardQueryOptions,
  type Dashboard,
} from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { useUnsavedChanges } from "@openchart/app/lib/unsaved-changes/unsaved-changes";
import {
  WidgetContext,
  type WidgetDefinition,
} from "@openchart/app/lib/widget/widget";

type Placement = Dashboard["widgets"][number];

/** Mount a feature by placement identity; the host never queries its business data. @example <WidgetHost {...placementProps} /> */
export function WidgetHost({
  placement,
  dashboardId,
  transport,
  definition,
  disabled,
  onPlaceBeside,
  onRemove,
  onLayout,
}: {
  placement: Placement;
  dashboardId: string;
  transport: AppTransport;
  definition: WidgetDefinition | undefined;
  disabled: boolean;
  onPlaceBeside: (
    anchorId: string,
    definition: WidgetDefinition,
    resourceId?: string,
  ) => string;
  onRemove: () => void;
  onLayout?: (layout: Placement["layout"]) => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const changes = useUnsavedChanges();
  const [holds, setHolds] = useState(0);
  const holdControls = useCallback(() => {
    setHolds((count) => count + 1);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      setHolds((count) => count - 1);
    };
  }, []);
  const context = useMemo(
    () => ({
      placementId: placement.id,
      dashboardId,
      transport,
      holdControls,
      placeBeside: (definition: WidgetDefinition, resourceId?: string) =>
        onPlaceBeside(placement.id, definition, resourceId),
    }),
    [placement.id, dashboardId, transport, holdControls, onPlaceBeside],
  );
  const title = definition?.title ?? `Unsupported widget: ${placement.kind}`;
  const Provider = definition?.Provider ?? Fragment;
  const Controls = definition?.Controls;
  const Content = definition?.Content;
  const dragHandle = onLayout ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          data-widget-drag-handle
          size="icon-sm"
          variant="ghost"
          disabled={disabled}
          aria-label={`Move ${title}`}
          className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
          onKeyDown={(event) => {
            const steps: Record<string, readonly [number, number]> = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            };
            const step = steps[event.key];
            if (
              !step ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey
            )
              return;
            event.preventDefault();
            const [dx, dy] = step;
            const { x, y, w, h } = placement.layout;
            void onLayout({
              x: Math.max(0, Math.min(12 - w, x + dx)),
              y: Math.max(0, y + dy),
              w,
              h,
            }).catch(() => undefined);
          }}
        >
          <GripVertical className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Drag to move. Arrow keys move.</TooltipContent>
    </Tooltip>
  ) : null;
  const remove = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={disabled}
          aria-label="Remove from dashboard"
          onClick={() =>
            changes ? changes.close(placement.id, onRemove) : onRemove()
          }
        >
          <X className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Remove from dashboard</TooltipContent>
    </Tooltip>
  );
  return (
    <WidgetContext.Provider value={context}>
      <WidgetCard title={title} held={holds > 0}>
        <ErrorBoundary
          resetKeys={[placement.kind, placement.resourceId]}
          fallbackRender={({ resetErrorBoundary }) => (
            <>
              <WidgetControls>
                {dragHandle}
                {remove}
              </WidgetControls>
              <div
                role="alert"
                className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm"
              >
                <p>Couldn’t display this widget.</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await queryClient.refetchQueries({
                      queryKey: dashboardQueryOptions(transport, dashboardId)
                        .queryKey,
                    });
                    resetErrorBoundary();
                  }}
                >
                  Try again
                </Button>
              </div>
            </>
          )}
        >
          <Provider key={placement.kind}>
            <WidgetControls>
              {dragHandle}
              {Controls ? <Controls /> : null}
              {remove}
            </WidgetControls>
            <div className="h-full min-h-0 overflow-hidden rounded-lg">
              {Content ? (
                <Content />
              ) : (
                <p
                  role="status"
                  className="p-4 pt-16 text-sm text-muted-foreground"
                >
                  This widget type isn’t available: {placement.kind}.
                </p>
              )}
            </div>
          </Provider>
        </ErrorBoundary>
      </WidgetCard>
    </WidgetContext.Provider>
  );
}
