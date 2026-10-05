// Purpose: Compose the generic published Post Feed with source-aware links and Agent progress.
import { useAssistantContext } from "@assistant-ui/react";
import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useOutletContext } from "react-router";
import {
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import {
  BellPlusIcon,
  CalendarPlusIcon,
  CheckCheckIcon,
  MessagesSquareIcon,
  PencilIcon,
  RssIcon,
  SearchIcon,
} from "lucide-react";
import { SectionPage } from "@openchart/app/app/section-page";
import type { AppRouteContext } from "@openchart/app/app/route-context";
import { NewAlertMenu } from "@openchart/app/app/alerts/new-alert-menu";
import { NewScheduleMenu } from "@openchart/app/app/schedule/new-schedule-menu";
import { useCopilotControls } from "@openchart/app/app/agent/copilot-controls";
import { Button } from "@openchart/app/components/ui/button";
import { TooltipIconButton } from "@openchart/app/components/ui/tooltip-icon-button/tooltip-icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import { Input } from "@openchart/app/components/ui/input";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@openchart/app/components/ui/empty/empty";
import { Skeleton } from "@openchart/app/components/ui/skeleton";
import { Spinner } from "@openchart/app/components/ui/spinner";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@openchart/app/components/ui/toggle-group";
import { alertRuleQueryOptions } from "@openchart/app/features/alerts/api/queries";
import {
  postFeedQueryOptions,
  type Post,
  type PostFeedItem,
} from "@openchart/app/features/posts/api/queries";
import {
  PostCard,
  postAuthorName,
} from "@openchart/app/features/posts/components/post-card";
import {
  isPostUnread,
  usePostReadState,
} from "@openchart/app/features/posts/hooks/use-post-read-state";
import { agentQueryKeys } from "@openchart/app/lib/agent/queries";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { ResourceReferenceSpan } from "@openchart/app/features/agent/components/thread/transcript/markdown/resource-reference";
import { PostChart } from "./post-chart";
import { PostInstruction } from "./post-instruction";

const rulePath = (id: string) => `/app/alerts/rules/${encodeURIComponent(id)}`;

/** The nearest scrolling ancestor, so the next page starts loading before the end is visible. */
function scrollParent(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement)
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  return null;
}

/** Charts open at the alert a Post is about, otherwise at publication. */
function postMoment({ post, quotedPost }: PostFeedItem) {
  for (const source of [post, quotedPost])
    if (source?.origin.kind === "alert_event") return source.origin.occurredAt;
  return post.createdAt;
}

/** Read every published Post without admitting Agent work on navigation. @example <FeedPage /> */
export function FeedPage() {
  const { transport } = useOutletContext<AppRouteContext>();
  return (
    <SectionPage
      heading="Feed"
      label="Feed"
      sections={[]}
      actions={
        <div
          role="group"
          aria-label="Add"
          className="flex shrink-0 items-center gap-1"
        >
          <NewAlertMenu
            trigger={
              <TooltipIconButton
                className="size-8"
                tooltip="New alert"
                aria-label="New alert"
              >
                <BellPlusIcon aria-hidden="true" />
              </TooltipIconButton>
            }
          />
          <NewScheduleMenu
            transport={transport}
            trigger={
              <TooltipIconButton
                className="size-8"
                tooltip="New schedule"
                aria-label="New schedule"
              >
                <CalendarPlusIcon aria-hidden="true" />
              </TooltipIconButton>
            }
          />
        </div>
      }
    >
      <PostFeed
        transport={transport}
        createAction={
          <div className="flex flex-wrap justify-center gap-2">
            <NewAlertMenu />
            <NewScheduleMenu transport={transport} />
          </div>
        }
      />
    </SectionPage>
  );
}

function PostFeed({
  transport,
  createAction,
}: {
  transport: AppTransport;
  createAction: ReactNode;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());
  const read = usePostReadState();
  // Mark all read applies to the whole feed, including unloaded and filtered posts.
  const unreadPosts = useInfiniteQuery(postFeedQueryOptions(transport, read));
  const hasUnreadPosts = unreadPosts.data?.some(({ post }) =>
    isPostUnread(read, post),
  );
  const posts = useInfiniteQuery(
    postFeedQueryOptions(
      transport,
      filter === "unread"
        ? { lastReadAt: read.lastReadAt, readIds: read.readIds }
        : undefined,
      query || undefined,
    ),
  );
  // Like Bluesky, nearing the end of the stream loads the next page; failures toast with Retry.
  const end = useRef<HTMLDivElement>(null);
  const {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = posts;
  useEffect(() => {
    const target = end.current;
    if (!target || !hasNextPage || isFetchingNextPage || isFetchNextPageError)
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void fetchNextPage();
      },
      { root: scrollParent(target), rootMargin: "0px 0px 600px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  useAssistantContext({
    getContext: () =>
      JSON.stringify({
        view: "feed",
        filter,
        search: query,
        loadedPostIds: (posts.data ?? []).map(({ post }) => post.id),
        hasMore: posts.hasNextPage,
      }),
  });
  const eventIds = [
    ...new Set(
      (posts.data ?? []).flatMap(({ post }) =>
        post.origin.kind === "alert_event"
          ? [post.origin.eventId]
          : post.origin.alert
            ? [post.origin.alert.eventId]
            : [],
      ),
    ),
  ];
  const executions = useQuery(
    queryOptions({
      meta: { errorTitle: "Couldn’t load alert executions" },
      queryKey: [
        ...agentQueryKeys.sessions(transport.url),
        "alert-feed",
        eventIds,
      ],
      enabled: eventIds.length > 0,
      queryFn: async ({ signal }) => {
        const pages = [];
        for (let i = 0; i < eventIds.length; i += 200)
          pages.push(
            transport.rpc.resources.macro.alertFeedExecutions.query(
              { eventIds: eventIds.slice(i, i + 200) },
              { signal, context: { method: "POST" } },
            ),
          );
        return (await Promise.all(pages)).flat();
      },
    }),
  );
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="search" className="relative min-w-48 flex-1">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            spellCheck={false}
            aria-label="Search feed"
            placeholder="Search posts"
            value={search}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
            className="rounded-full border-transparent bg-muted/50 pl-9 shadow-none focus-visible:bg-background"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label="Filter posts"
            value={filter}
            onValueChange={(value) => {
              if (value) setFilter(value);
            }}
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="unread">Unread</ToggleGroupItem>
          </ToggleGroup>
          {hasUnreadPosts ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => read.markAllRead(Date.now())}
            >
              <CheckCheckIcon aria-hidden="true" />
              Mark all read
            </Button>
          ) : null}
        </div>
      </div>
      {!posts.data ? (
        posts.isError ? (
          <Button
            variant="outline"
            onClick={() => {
              void posts.refetch();
            }}
          >
            Retry loading feed
          </Button>
        ) : (
          <Skeleton role="status" aria-label="Loading feed" className="h-40" />
        )
      ) : posts.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RssIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              {query
                ? "No matching posts"
                : filter === "unread"
                  ? "You’re all caught up"
                  : "No posts yet"}
            </EmptyTitle>
            <EmptyDescription>
              {query
                ? "Try another name, symbol or phrase."
                : filter === "unread"
                  ? "New posts will appear here."
                  : "Posts from your agents, alerts and scheduled tasks will appear here."}
            </EmptyDescription>
          </EmptyHeader>
          {!query && filter === "all" ? (
            <EmptyContent>{createAction}</EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div aria-label="Posts" className="overflow-hidden rounded-lg border">
          {posts.data.map((item) => {
            const origin = item.post.origin;
            const eventId =
              origin.kind === "alert_event"
                ? origin.eventId
                : origin.alert?.eventId;
            const runs =
              executions.data?.find((item) => item.eventId === eventId)?.runs ??
              [];
            const triggerId =
              origin.kind === "agent_run"
                ? runs.find(
                    (run) => run.runId === origin.runId && run.canEditPrompt,
                  )?.triggerId
                : undefined;
            // A Rule Post shows its Agent at work only as the shared Spinner.
            const working =
              origin.kind === "alert_event" &&
              runs.some(
                (run) => run.status === "queued" || run.status === "running",
              );
            return (
              <PostCard
                key={item.post.id}
                item={item}
                transport={transport}
                unread={isPostUnread(read, item.post)}
                onRead={() => read.markRead(item.post.id)}
                renderAuthor={(post) => (
                  <PostAuthor post={post} transport={transport} />
                )}
                renderReference={(reference) => (
                  <ResourceReferenceSpan
                    data-resource-type={reference.resource}
                    data-resource-id={reference.id}
                    data-resource-label={reference.label}
                  />
                )}
                renderResource={(reference) =>
                  reference.resource === "chart" ? (
                    <PostChart
                      transport={transport}
                      chartId={reference.id}
                      at={postMoment(item)}
                    />
                  ) : null
                }
                actions={
                  <PostActions
                    post={item.post}
                    transport={transport}
                    triggerId={triggerId}
                    working={working}
                  />
                }
              />
            );
          })}
        </div>
      )}
      <div ref={end} data-feed-end aria-hidden="true" />
      {posts.isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Spinner
            size="sm"
            className="!size-4 text-muted-foreground"
            label="Loading more posts"
          />
        </div>
      ) : null}
    </div>
  );
}

function PostAuthor({
  post,
  transport,
}: {
  post: Post;
  transport: AppTransport;
}) {
  const rule = useQuery(
    alertRuleQueryOptions(
      transport,
      post.author.kind === "rule" ? post.author.ruleId : undefined,
    ),
  );
  const name = postAuthorName(post);
  return rule.data ? (
    <Link
      to={rulePath(rule.data.id)}
      className="rounded-sm underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-ring"
    >
      {name}
    </Link>
  ) : (
    <>{name}</>
  );
}

function PostActions({
  post,
  transport,
  triggerId,
  working = false,
}: {
  post: Post;
  transport: AppTransport;
  triggerId?: string;
  working?: boolean;
}) {
  const copilot = useCopilotControls();
  const origin = post.origin;
  const ruleId =
    origin.kind === "alert_event" ? origin.ruleId : origin.alert?.ruleId;
  const rule = useQuery(alertRuleQueryOptions(transport, ruleId));
  // Icon-only actions name themselves in tooltips.
  return (
    <>
      {working ? (
        <span className="grid size-7 place-items-center">
          <Spinner
            size="sm"
            className="!size-3.5 text-muted-foreground"
            label="Working"
          />
        </span>
      ) : (
        <PostInstruction post={post} transport={transport} />
      )}
      {origin.kind === "agent_run" ? (
        <TooltipIconButton
          tooltip="Open session"
          side="top"
          className="size-7 text-muted-foreground"
          disabled={!copilot}
          onClick={() => copilot?.selectSession(origin.sessionId)}
        >
          <MessagesSquareIcon aria-hidden="true" className="size-3.5" />
        </TooltipIconButton>
      ) : null}
      {triggerId && rule.data ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
              >
                <Link
                  to={`${rulePath(rule.data.id)}?action=${encodeURIComponent(triggerId)}`}
                  aria-label="Edit prompt"
                >
                  <PencilIcon aria-hidden="true" className="size-3.5" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Edit prompt</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </>
  );
}
