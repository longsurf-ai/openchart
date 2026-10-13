// Purpose: Renders a Markdown answer preview and opens its ordinary bound Agent Session.
import { useMutation } from "@tanstack/react-query";
import {
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { RefreshCw, Square } from "lucide-react";
import { Button } from "@openchart/app/components/ui/button";
import { ShimmerLabel } from "@openchart/app/components/ui/shimmer-label/shimmer-label";
import { useWidget } from "@openchart/app/hooks/use-widget";
import { useAgentContext } from "@openchart/app/lib/agent/provider";
import { useBoundSession } from "@openchart/app/lib/agent/use-bound-session";
import { usePublishSemanticValue } from "../hooks/use-semantic-values";
import { latestSemanticAnswer } from "../utils/semantic-answer";
import { WatchlistOpenSession } from "./context";
import {
  useSemanticContext,
  useSemanticColumn,
  cellBinding,
} from "./semantic-context";

import "./semantic-cell.css";

/** Projects the bound Session's progress and Markdown preview for display and mounted sorting. Clicking a completed answer opens that Session; workflow failures remain retryable. */
export function SemanticCell({
  columnId,
  itemId,
  title,
}: {
  columnId: string;
  itemId: string;
  title: string;
}) {
  const { watchlist, start } = useSemanticContext();
  const { transport } = useWidget();
  const { agent } = useAgentContext();
  const openSession = useContext(WatchlistOpenSession);
  const column = useSemanticColumn(columnId);
  const bound = useBoundSession(
    transport,
    cellBinding(watchlist.id, columnId, itemId),
  );
  const messages = bound.snapshot.messages;
  const preview = useMemo(() => latestSemanticAnswer(messages), [messages]);
  const failed =
    bound.execution === "failed" || bound.execution === "cancelled";
  const queued =
    !!column.request &&
    (!column.request.itemIds || column.request.itemIds.includes(itemId)) &&
    (!bound.session || bound.session.createdAt < column.request.createdAt);
  const result = bound.progress || queued || failed ? undefined : preview;
  const answered =
    !queued &&
    !failed &&
    (result !== undefined || bound.execution === "completed");
  usePublishSemanticValue(itemId, columnId, result);
  const progress = bound.progress;
  const attention =
    !!bound.snapshot.state?.permissions.length ||
    !!bound.snapshot.state?.questions.length;
  const progressLabel = attention
    ? "Needs your response"
    : (progress?.lines.at(-1) ??
      (queued || progress?.status === "queued"
        ? "Queued…"
        : "Preparing research…"));
  const executionSessionId =
    bound.executionSessionId ?? (queued ? column.bound.session?.id : undefined);
  const stop = useMutation({
    mutationFn: () => agent.getSession(executionSessionId!).cancel(),
    meta: { errorTitle: "Couldn’t stop research" },
  });
  const refresh = () => start.mutate({ columnId, itemIds: [itemId] });
  return (
    <div
      role="presentation"
      data-slot="semantic-cell"
      className="flex min-w-0 items-center gap-1 px-2"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {progress || queued ? (
        <span
          role="status"
          className="min-w-0 flex-1 text-left text-xs text-muted-foreground"
          title={progressLabel}
          aria-label={`${title} research progress`}
        >
          <CellText text={progressLabel} shimmer={!attention} />
        </span>
      ) : answered ? (
        <button
          type="button"
          className="min-w-0 flex-1 text-left text-xs focus-visible:outline focus-visible:outline-ring"
          title={result ?? "Open research transcript"}
          disabled={!openSession || !bound.session}
          onClick={() => openSession?.(bound.session!.id)}
        >
          <CellText text={result ?? "—"} />
        </button>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          className="h-5 min-w-0 flex-1 justify-start text-xs text-muted-foreground"
          disabled={bound.loading || column.busy}
          onClick={bound.retry ?? refresh}
        >
          {bound.retry
            ? "Retry connection"
            : bound.execution === "failed"
              ? "Failed · retry"
              : bound.execution === "cancelled"
                ? "Stopped · retry"
                : "Generate"}
        </Button>
      )}
      {(progress || queued) && executionSessionId ? (
        <Button
          size="icon-xs"
          variant="ghost"
          className="size-5"
          title="Stop this research run"
          aria-label={`Stop ${title} research`}
          disabled={stop.isPending}
          onClick={() => stop.mutate()}
        >
          <Square className="size-3" />
        </Button>
      ) : answered ? (
        <Button
          size="icon-xs"
          variant="ghost"
          className="size-5"
          aria-label={`Refresh ${title}`}
          disabled={column.busy}
          onClick={refresh}
        >
          <RefreshCw className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}

// V1's overflow-only, hover/focus loop, measured again when text or cell width changes.
function CellText({
  text,
  shimmer = false,
}: {
  text: string;
  shimmer?: boolean;
}) {
  const viewport = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const [duration, setDuration] = useState(0);
  useLayoutEffect(() => {
    const outer = viewport.current!;
    const inner = content.current!;
    const measure = () => {
      const width = inner.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(inner.parentElement!).columnGap);
      setDuration(width > outer.clientWidth ? (width + gap) / 36 : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span
      ref={viewport}
      data-slot="semantic-cell-text"
      data-rollable={duration > 0 || undefined}
      style={
        { "--semantic-cell-roll-duration": `${duration}s` } as CSSProperties
      }
    >
      <span data-slot="semantic-cell-text-track">
        <span ref={content}>
          <ShimmerLabel active={shimmer}>{text}</ShimmerLabel>
        </span>
        {duration > 0 && (
          <span aria-hidden>
            <ShimmerLabel active={shimmer}>{text}</ShimmerLabel>
          </span>
        )}
      </span>
    </span>
  );
}
