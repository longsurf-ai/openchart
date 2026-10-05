// Purpose: Read persisted Post feeds and immutable media through Resource-owned queries.
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type {
  AppTransport,
  ResourceOutputs,
} from "@openchart/app/lib/transport/transport";
import type { PostReadState } from "@openchart/app/features/posts/hooks/use-post-read-state";

/** Persistent Post wire contract, derived from the Resource owner. */
export type Post = ResourceOutputs["post"]["get"];
export type PostFeedItem = ResourceOutputs["post"]["feed"]["items"][number];

/** Filtering happens before pagination; read IDs travel in a POST body. Resource events and reconnect refresh every page. @example useInfiniteQuery(postFeedQueryOptions(transport, read)); */
export function postFeedQueryOptions(
  transport: AppTransport,
  unread?: PostReadState,
  search?: string,
) {
  return infiniteQueryOptions({
    meta: { errorTitle: "Couldn’t load the feed" },
    queryKey: [
      ["resources", "post", "feed"],
      transport.url,
      search,
      unread,
    ] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      transport.rpc.resources.post.feed.query(
        {
          limit: 20,
          cursor: pageParam,
          search,
          unread: unread
            ? { after: unread.lastReadAt, excludeIds: unread.readIds }
            : undefined,
        },
        { signal, context: { method: "POST" } },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.items),
  });
}

/** Exact unread counts include unloaded pages and both kinds of Alert Post. @example useQuery(postUnreadCountsQueryOptions(transport, ids, read)); */
export function postUnreadCountsQueryOptions(
  transport: AppTransport,
  ruleIds: readonly string[],
  read: PostReadState,
) {
  return queryOptions({
    meta: { errorTitle: "Couldn’t load unread post counts" },
    queryKey: [
      ["resources", "post", "unreadCounts"],
      transport.url,
      ruleIds,
      read.lastReadAt,
      read.readIds,
    ] as const,
    enabled: ruleIds.length > 0,
    queryFn: async ({ signal }) => {
      const pages = [];
      for (let i = 0; i < ruleIds.length; i += 200)
        pages.push(
          transport.rpc.resources.post.unreadCounts.query(
            {
              ruleIds: ruleIds.slice(i, i + 200),
              after: read.lastReadAt,
              excludeIds: read.readIds,
            },
            { signal, context: { method: "POST" } },
          ),
        );
      return (await Promise.all(pages)).flat();
    },
  });
}

/** Media stays outside Feed pages and is requested only when its block mounts. @example useQuery(postMediaQueryOptions(transport, mediaId)); */
export function postMediaQueryOptions(transport: AppTransport, id: string) {
  return queryOptions({
    meta: { errorTitle: "Couldn’t load this attachment" },
    queryKey: [["resources", "post", "media"], transport.url, id] as const,
    queryFn: ({ signal }) =>
      transport.rpc.resources.post.media.query({ id }, { signal }),
    staleTime: Infinity,
  });
}
