// Avatar/header/body/action structure with shared theme tokens, real Post content, one-level quotes and app-supplied actions. No social counters or invented engagement.
// Attachments use the shared Carousel after the text.
import type { ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
} from "@openchart/app/components/ui/avatar/avatar";
import { Button } from "@openchart/app/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@openchart/app/components/ui/carousel/carousel";
import {
  Markdown,
  type MarkdownResourceReference,
} from "@openchart/app/components/ui/markdown/markdown";
import { Skeleton } from "@openchart/app/components/ui/skeleton";
import {
  postMediaQueryOptions,
  type Post,
  type PostFeedItem,
} from "@openchart/app/features/posts/api/queries";
import { nativeProviderBrand } from "@openchart/app/lib/agent/native-provider-brands";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

/** The application host renders visual Resources as attachments; null leaves a Resource out. */
export type PostResourceRenderer = (
  reference: Extract<Post["content"][number], { type: "resource" }>,
) => ReactNode;
/** The application host renders inline Resource references in the text as links. */
export type PostReferenceRenderer = (
  reference: MarkdownResourceReference,
) => ReactNode;

/** Providers retain their registered identity; familiar names are presentation only. @example postAuthorName(post); */
export function postAuthorName(post: Post) {
  if (post.author.kind === "rule") return post.author.name;
  const { providerId } = post.author;
  return nativeProviderBrand(providerId)?.agent ?? providerId;
}

function PostHeader({
  post,
  unread = false,
  quoted = false,
  renderAuthor,
}: {
  post: Post;
  unread?: boolean;
  quoted?: boolean;
  renderAuthor?: (post: Post) => ReactNode;
}) {
  const time =
    post.origin.kind === "alert_event"
      ? post.origin.occurredAt
      : post.createdAt;
  const name = postAuthorName(post);
  const author = renderAuthor ? renderAuthor(post) : name;
  const timestamp = (className: string) => (
    <time
      dateTime={new Date(time).toISOString()}
      title={new Date(time).toLocaleString()}
      className={className}
    >
      {new Date(time).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}
    </time>
  );
  // Quotes follow Bluesky's embed meta: a small avatar, then author and time on one line.
  if (quoted)
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <Avatar className="size-4">
          <AvatarFallback className="text-2xs">
            {name.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 truncate font-medium">{author}</span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        {timestamp("shrink-0 text-muted-foreground")}
      </div>
    );
  return (
    <div className="flex items-baseline gap-3">
      <span className="min-w-0 flex-1 break-words text-sm font-medium">
        {author}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {timestamp("text-right text-xs text-muted-foreground")}
        {unread ? (
          <span className="size-1.5 rounded-full bg-primary">
            <span className="sr-only">Unread</span>
          </span>
        ) : null}
      </span>
    </div>
  );
}

function PostMedia({
  transport,
  block,
}: {
  transport: AppTransport;
  block: Extract<Post["content"][number], { type: "media" }>;
}) {
  const media = useQuery(postMediaQueryOptions(transport, block.mediaId));
  if (!media.data)
    return media.isError ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void media.refetch();
        }}
      >
        Retry attachment
      </Button>
    ) : (
      <Skeleton
        role="status"
        aria-label="Loading attachment"
        className="h-32"
      />
    );
  const { mime, filename, base64 } = media.data;
  const src = `data:${mime};base64,${base64}`;
  return mime.startsWith("image/") ? (
    <img
      src={src}
      alt={block.description || filename}
      loading="lazy"
      className="h-80 w-full rounded-md object-contain"
    />
  ) : mime.startsWith("video/") ? (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- Published media currently has descriptions, not timed caption tracks; never fabricate a transcript.
    <video
      src={src}
      controls
      preload="metadata"
      aria-label={block.description || filename}
      className="h-80 w-full rounded-md"
    />
  ) : null;
}

/** Bluesky embeds only images and video; any other file follows the attachments as a download. */
const isVisual = (mime: string) =>
  mime.startsWith("image/") || mime.startsWith("video/");

function PostFile({
  transport,
  block,
}: {
  transport: AppTransport;
  block: Extract<Post["content"][number], { type: "media" }>;
}) {
  const { data } = useQuery(postMediaQueryOptions(transport, block.mediaId));
  if (!data) return null;
  const { mime, filename, base64 } = data;
  return (
    <a
      href={`data:${mime};base64,${base64}`}
      download={filename}
      className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-ring"
    >
      <DownloadIcon aria-hidden="true" className="size-4" />
      {filename}
    </a>
  );
}

function PostContent({
  post,
  transport,
  renderResource,
  renderReference,
}: {
  post: Post;
  transport: AppTransport;
  renderResource: PostResourceRenderer;
  renderReference?: PostReferenceRenderer;
}) {
  // Media types are known once loaded; the shared cache serves PostMedia and PostFile too.
  const media = post.content.flatMap((block) =>
    block.type === "media" ? [block] : [],
  );
  const loaded = useQueries({
    queries: media.map((block) =>
      postMediaQueryOptions(transport, block.mediaId),
    ),
  });
  const files = new Set(
    media.flatMap((block, index) => {
      const mime = loaded[index]?.data?.mime;
      return mime !== undefined && !isVisual(mime) ? [block.mediaId] : [];
    }),
  );
  const slides = post.content.flatMap((block, index) => {
    if (block.type === "text") return [];
    if (block.type === "media" && files.has(block.mediaId)) return [];
    const slide =
      block.type === "media" ? (
        <PostMedia transport={transport} block={block} />
      ) : (
        renderResource(block)
      );
    return slide ? [<CarouselItem key={index}>{slide}</CarouselItem>] : [];
  });
  return (
    <div className="mt-1 space-y-3 text-sm leading-relaxed">
      {post.content.map((block, index) =>
        block.type === "text" ? (
          <Markdown
            key={index}
            text={block.text}
            renderReference={renderReference}
          />
        ) : null,
      )}
      {slides.length > 0 ? (
        // Charts own drag gestures, so slides change only with the arrows or arrow keys.
        <Carousel
          opts={{ watchDrag: false }}
          aria-label="Attachments"
          className="group/attachments"
        >
          <CarouselContent>{slides}</CarouselContent>
          {slides.length > 1 ? (
            <>
              <CarouselPrevious className={`left-2 ${hoverArrow}`} />
              <CarouselNext className={`right-2 ${hoverArrow}`} />
            </>
          ) : null}
        </Carousel>
      ) : null}
      {post.content.map((block, index) =>
        block.type === "media" && files.has(block.mediaId) ? (
          <div key={index}>
            <PostFile transport={transport} block={block} />
          </div>
        ) : null,
      )}
    </div>
  );
}

// Visual slides share the chart's h-80 frame so the carousel keeps one height.
// Arrows appear while the pointer or keyboard focus is on the attachments, and hide at either end.
const hoverArrow =
  "opacity-0 transition-opacity group-focus-within/attachments:opacity-100 group-hover/attachments:opacity-100 disabled:invisible motion-reduce:transition-none";

/** Published Post row; quotes render the current Post once and never recurse. @example <PostCard item={item} transport={transport} renderResource={renderResource} /> */
export function PostCard({
  item: { post, quotedPost },
  transport,
  renderResource,
  renderReference,
  actions,
  unread,
  onRead,
  renderAuthor,
}: {
  item: PostFeedItem;
  transport: AppTransport;
  renderResource: PostResourceRenderer;
  renderReference?: PostReferenceRenderer;
  actions?: ReactNode;
  unread?: boolean;
  onRead?: () => void;
  renderAuthor?: (post: Post) => ReactNode;
}) {
  const name = postAuthorName(post);
  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- Keep article semantics for nested links/media while Enter/Space marks the focused card read. */
  return (
    <article
      aria-label={`Post by ${name}`}
      tabIndex={onRead ? 0 : undefined}
      onClick={() => {
        if (unread) onRead?.();
      }}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          if (unread) onRead?.();
        }
      }}
      className="border-b border-border/60 px-4 py-4 transition-colors last:border-b-0 hover:bg-muted/30 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
    >
      <div className="flex items-start gap-3">
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">
            {name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <PostHeader post={post} unread={unread} renderAuthor={renderAuthor} />
          <PostContent
            post={post}
            transport={transport}
            renderResource={renderResource}
            renderReference={renderReference}
          />
          {post.quotedPostId ? (
            // A figure, not a blockquote: prose would wrap a quoted Post in quotation marks.
            <figure
              aria-label="Quoted post"
              className="mt-3 rounded-md border p-3"
            >
              {quotedPost ? (
                <>
                  <PostHeader
                    post={quotedPost}
                    quoted
                    renderAuthor={renderAuthor}
                  />
                  <PostContent
                    post={quotedPost}
                    transport={transport}
                    renderResource={renderResource}
                    renderReference={renderReference}
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The quoted post is no longer available.
                </p>
              )}
            </figure>
          ) : null}
          {actions ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
}
