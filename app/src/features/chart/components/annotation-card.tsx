// Purpose: Project V1 annotation chrome onto the canvas-owned expanded rectangle.
import { v2 } from "@openchart/chart-core";
import {
  resolveAgentAnnotationAccentColor,
  sourceBadgeColor,
  sourceBadgeText,
  type AnnotationSourceBadge,
} from "@openchart/chart-core/annotation";
import { Bus, ChartEvent } from "@openchart/chart-core/bus";
import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { z } from "zod";

import { Button } from "@openchart/app/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import { useChart, useChartState } from "@openchart/app/hooks/use-chart";
import { cn } from "@openchart/app/utils/cn";

type Hover = z.infer<typeof ChartEvent.AnnotationHover.schema>["hit"];

/** Keep content in Drawing and geometry/dragging in core; chrome only projects them.
 * @example <AnnotationCard />
 */
export function AnnotationCard() {
  const chart = useChart();
  const [hit, setHit] = useState<Hover>(null);
  const badges = useChartState((state) =>
    state.expandedAnnotation
      ? state.sourceBadgesByAnnotationId?.[state.expandedAnnotation.id]
      : undefined,
  );
  const annotation = useChartState((state) => {
    const item = v2.ChartStateModel.drawingItems(state).find(
      (drawing) => drawing.id === state.expandedAnnotation?.id,
    );
    return item?.type === "annotation" && !item.hidden ? item : undefined;
  });
  useEffect(
    () =>
      Bus.subscribe<z.infer<typeof ChartEvent.AnnotationHover.schema>>(
        ChartEvent.AnnotationHover,
        (event) => {
          if (event.id === chart.id)
            setHit(
              event.hit?.kind === "chart_annotation" && event.hit.expanded
                ? event.hit
                : null,
            );
        },
      ),
    [chart],
  );
  const close = useCallback(
    () =>
      chart.mutate((state) => {
        state.expandedAnnotation = undefined;
        state.hoveredAnnotationId = undefined;
        state.hoveredAnnotationPart = undefined;
      }),
    [chart],
  );
  useEffect(() => {
    if (!annotation) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [annotation, close]);
  if (!annotation || hit?.id !== annotation.id || !hit.pill) return null;
  const date = new Date(annotation.time * 1000).toISOString().slice(0, 10);
  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The card shares the canvas's pointer drag; its links and buttons keep native keyboard behavior.
    <section
      aria-label={annotation.title}
      data-annotation-hover-card={annotation.id}
      className={cn(
        "fixed z-50 box-border flex flex-col overflow-hidden rounded-lg border px-4 pb-3 pt-4 shadow-[0_20px_48px_hsl(0_0%_0%/0.42)]",
        !annotation.locked && "cursor-grab active:cursor-grabbing",
      )}
      style={{
        left: hit.pill.x,
        top: hit.pill.y,
        width: hit.pill.width,
        height: hit.pill.height,
        background:
          "color-mix(in srgb, var(--chart-agent-annotation-fill) 97%, transparent)",
        color: "var(--chart-agent-annotation-text)",
        borderColor: "var(--chart-agent-annotation-divider)",
      }}
      onMouseDown={(event) => {
        if (
          event.button !== 0 ||
          (event.target as HTMLElement).closest(
            "button, a, input, textarea, select, [role=button]",
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        chart.renderer.beginAnnotationDrag(annotation.id, {
          x: event.clientX,
          y: event.clientY,
        });
      }}
      onMouseLeave={(event) => {
        if (event.buttons === 0) close();
      }}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !event.currentTarget.matches(":hover")
        )
          close();
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ background: resolveAgentAnnotationAccentColor(annotation) }}
      />
      <div className="flex shrink-0 items-start justify-between gap-3">
        <h3 className="line-clamp-2 min-w-0 text-lg font-semibold leading-snug">
          {annotation.title}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          aria-label="Close"
          onClick={close}
        >
          <X />
        </Button>
      </div>
      <div className="mt-3 flex shrink-0 items-center gap-2.5 text-xs text-[var(--chart-agent-annotation-muted)]">
        {annotation.sources.length > 0 && (
          <>
            <div className="flex max-w-[45%] -space-x-1 overflow-x-auto hover:space-x-1">
              {annotation.sources.map((source, index) => {
                const badge = badges?.find(
                  (badge) => badge.id === source.url,
                ) ?? { id: source.url, label: source.title };
                return (
                  <Tooltip key={`${source.url}:${index}`}>
                    <TooltipTrigger asChild>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={source.title}
                        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--chart-agent-annotation-fill)] text-xs font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <SourceIcon key={badge.logoUrl} badge={badge} />
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>{source.title}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
            <span className="shrink-0">
              {annotation.sources.length}{" "}
              {annotation.sources.length === 1 ? "source" : "sources"}
            </span>
            <span>·</span>
          </>
        )}
        <time dateTime={date} className="truncate">
          {date}
        </time>
      </div>
      <div
        className={cn(
          "relative mt-3 min-h-0",
          hit.bodyExpanded ? "overflow-y-auto" : "overflow-hidden",
        )}
      >
        <p
          className={cn(
            "whitespace-pre-wrap break-words text-sm leading-5 text-[var(--chart-agent-annotation-muted)]",
            !hit.bodyExpanded && "line-clamp-3",
          )}
        >
          {annotation.body}
        </p>
        {hit.bodyTruncated && !hit.bodyExpanded && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="absolute bottom-0 right-0 h-5 pl-7 pr-1 text-xs text-[var(--chart-agent-annotation-muted)]"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--chart-agent-annotation-fill) 24px)",
            }}
            onClick={() =>
              chart.mutate((state) => {
                state.expandedAnnotation = { id: annotation.id, body: "full" };
              })
            }
            aria-label="Read full explanation"
            aria-expanded={false}
          >
            more
          </Button>
        )}
      </div>
    </section>,
    document.body,
  );
}

function SourceIcon({ badge }: { badge: AnnotationSourceBadge }) {
  const [failed, setFailed] = useState(false);
  const logo = !failed && badge.logoUrl;
  return (
    <span
      className="flex size-full items-center justify-center overflow-hidden rounded-full"
      style={{ background: logo ? undefined : sourceBadgeColor(badge) }}
    >
      {logo ? (
        <img
          src={logo}
          alt=""
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        sourceBadgeText(badge)
      )}
    </span>
  );
}
