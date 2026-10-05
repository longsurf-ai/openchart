// Purpose: Present compact saved events and links to their existing conversations.
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  BellIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MessageCircleIcon,
} from "lucide-react";
import { Button } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@openchart/app/components/ui/empty/empty";
import { Skeleton } from "@openchart/app/components/ui/skeleton";
import { LoadMore } from "@openchart/app/components/ui/load-more/load-more";
import { TimezoneControl } from "@openchart/app/components/ui/timezone-control/timezone-control";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { cn } from "@openchart/app/utils/cn";
import {
  alertEventPagesQueryOptions,
  alertEventExecutionsQueryOptions,
  type AlertEvent,
  type AlertEventSession,
} from "../api/queries";
import { alertEventFacts, groupAlertEvents } from "../lib/event-presentation";

/**
 * Read-only Rule history. Query owns pagination, linked-session reads and
 * cancellation; this component owns sorting, disclosure and display timezone.
 * Its clock is released on unmount. Failed reads retain loaded content and
 * offer retry through shared Query handling. Sessions come only from accepted
 * Runs for these events, deduplicated by ID; opening delegates to the host and
 * never admits Agent work. Missing source facts remain absent.
 * @example <AlertEvents transport={transport} ruleId={rule.id} onOpenSession={selectSession} />
 */
export function AlertEvents({
  transport,
  ruleId,
  onOpenSession,
  renderFooter,
}: {
  transport: AppTransport;
  ruleId: string;
  onOpenSession: (sessionId: string) => void;
  /** The page pins display controls outside its scroll area. Standalone use renders them below the list. */
  renderFooter?: (footer: ReactNode) => ReactNode;
}) {
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("local");
  const time = useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone === "local" ? undefined : timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    [timezone],
  );
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const query = useInfiniteQuery(
    alertEventPagesQueryOptions(transport, ruleId, order),
  );
  const events = query.data?.pages.flatMap((page) => page.items) ?? [];
  const total = query.data?.pages[0]?.total;
  const executions = useQuery(
    alertEventExecutionsQueryOptions(
      transport,
      events.map((event) => event.id),
    ),
  );
  const sessions = new Map(
    (executions.data ?? []).map(({ eventId, runs }) => [
      eventId,
      [...new Map(runs.map((run) => [run.sessionId, run])).values()],
    ]),
  );
  const groups = groupAlertEvents(events, now, timezone);
  const footer =
    events.length > 0 ? (
      <div className="w-full overflow-y-auto [scrollbar-gutter:stable_both-edges]">
        <div className="mx-auto w-full max-w-6xl sm:px-3">
          <TimezoneControl
            value={timezone}
            onValueChange={setTimezone}
            className="px-0 has-[>svg]:px-0"
          />
        </div>
      </div>
    ) : null;
  return (
    <>
      <div className="mx-auto w-full max-w-6xl py-6 sm:px-3">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-base font-medium">
              {groups[0]?.label ?? "Events"}
            </h2>
            {total !== undefined ? (
              <span className="text-sm text-muted-foreground">
                {total.toLocaleString()}{" "}
                {total === 1 ? "event" : "events total"}
              </span>
            ) : null}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Event order"
                className="text-muted-foreground"
              >
                {order === "desc" ? "Newest first" : "Oldest first"}
                <ChevronDownIcon className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={order}
                onValueChange={(value) => {
                  setOrder(value === "asc" ? "asc" : "desc");
                  setExpanded(null);
                }}
              >
                <DropdownMenuRadioItem value="desc">
                  Newest first
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="asc">
                  Oldest first
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {query.isPending ? (
          <Skeleton
            role="status"
            aria-label="Loading events"
            className="h-48"
          />
        ) : null}
        {query.isError && !query.isFetchNextPageError ? (
          <Button
            variant="outline"
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry loading events
          </Button>
        ) : null}
        {query.isSuccess && total === 0 ? (
          <Empty className="py-20">
            <EmptyHeader>
              <BellIcon
                className="mb-2 size-6 text-muted-foreground"
                aria-hidden="true"
              />
              <EmptyTitle>No events yet</EmptyTitle>
              <EmptyDescription>
                Recorded triggers will appear here when this alert fires.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        <div className="space-y-8">
          {groups.map((group, index) => (
            <section key={group.key} aria-label={group.label}>
              {index > 0 ? (
                <h3 className="mb-5 text-base font-medium">{group.label}</h3>
              ) : null}
              <ol className="space-y-6">
                {group.events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    time={time}
                    sessions={sessions.get(event.id) ?? []}
                    onOpenSession={onOpenSession}
                    expanded={expanded === event.id}
                    onToggle={() =>
                      setExpanded(expanded === event.id ? null : event.id)
                    }
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
        {executions.isError ? (
          <Button
            variant="link"
            size="sm"
            className="mt-4 px-0"
            onClick={() => {
              void executions.refetch();
            }}
          >
            Retry loading sessions
          </Button>
        ) : null}
        <LoadMore
          hasMore={query.hasNextPage}
          loading={query.isFetching}
          error={query.isFetchNextPageError}
          onLoadMore={() => {
            void query.fetchNextPage();
          }}
          label="Show more events"
        />
      </div>
      {renderFooter ? renderFooter(footer) : footer}
    </>
  );
}

function EventRow({
  event,
  time,
  sessions,
  onOpenSession,
  expanded,
  onToggle,
}: {
  event: AlertEvent;
  time: Intl.DateTimeFormat;
  sessions: readonly AlertEventSession[];
  onOpenSession: (sessionId: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  const facts = alertEventFacts(event);
  const title = event.detail.title.trim() || event.condition;
  const summary =
    [facts.symbol, facts.value]
      .filter((value) => value !== undefined)
      .join(" · ") || title;
  const metadata = [
    ["Provider", facts.provider],
    ["Interval", facts.resolution],
    ["Threshold", facts.threshold],
    ["Condition", event.condition],
  ] as const;
  return (
    <li className="grid grid-cols-[4.5rem_2rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[5.5rem_2.5rem_minmax(0,1fr)] sm:gap-x-6">
      <time
        dateTime={new Date(event.time).toISOString()}
        className="text-left text-xs tabular-nums leading-8 text-muted-foreground sm:text-sm sm:leading-10"
      >
        {time.format(event.time)}
      </time>
      <span className="flex size-8 items-center justify-center rounded-lg border bg-background sm:size-10">
        <BellIcon className="size-4 sm:size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1 sm:min-h-10">
          <h4 className="min-w-0 break-words text-base font-medium tabular-nums">
            {summary}
          </h4>
          {summary !== title ? (
            <span className="min-w-0 break-words text-sm text-muted-foreground">
              {title}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggle}
            aria-label={`Details for ${title}`}
            aria-expanded={expanded}
            aria-controls={id}
            className="h-auto gap-1 px-0 py-1 font-normal text-muted-foreground hover:bg-transparent"
          >
            Details
            <ChevronRightIcon
              className={cn("size-4", expanded && "rotate-90")}
              aria-hidden="true"
            />
          </Button>
        </div>
        <div id={id} hidden={!expanded} className="mt-3 space-y-3 pb-2 text-sm">
          <div className="grid max-w-3xl grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-x-10 gap-y-3">
            {event.detail.message.trim() ? (
              <p className="whitespace-pre-wrap break-words">
                {event.detail.message}
              </p>
            ) : null}
            <dl className="grid content-start gap-y-2">
              {metadata.map(([label, value]) =>
                value === undefined ? null : (
                  <div
                    key={label}
                    className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                  </div>
                ),
              )}
            </dl>
          </div>
          <pre
            aria-label="Event data"
            className="max-h-80 overflow-auto rounded-md bg-muted/40 p-3 text-xs text-muted-foreground"
          >
            {JSON.stringify(event.detail.data, null, 2)}
          </pre>
        </div>
        {sessions.length > 0 ? (
          <ul
            aria-label="Linked sessions"
            className="mt-1 flex flex-wrap gap-x-6 gap-y-1"
          >
            {sessions.map((session) => (
              <li key={session.sessionId} className="min-w-0 max-w-full">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto max-w-full justify-start gap-2 whitespace-normal px-0 py-1 text-left font-normal text-foreground has-[>svg]:px-0"
                  onClick={() => onOpenSession(session.sessionId)}
                >
                  <MessageCircleIcon className="size-4" aria-hidden="true" />
                  <span className="min-w-0 break-words">
                    {session.title.trim() || "Untitled session"}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
