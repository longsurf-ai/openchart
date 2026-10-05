// Purpose: Published text stays inert and precedes one attachment carousel; quote and media lifetimes are explicit.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PostCard } from "@openchart/app/features/posts/components/post-card";
import {
  postFeedQueryOptions,
  type Post,
} from "@openchart/app/features/posts/api/queries";
import { isPostUnread } from "@openchart/app/features/posts/hooks/use-post-read-state";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

const clients: QueryClient[] = [];
const imageId = "pmd_image" as Extract<
  Post["content"][number],
  { type: "media" }
>["mediaId"];
afterEach(() => {
  clients.forEach((client) => client.clear());
  clients.length = 0;
});
function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "pst_analysis",
    revision: 1,
    createdAt: 100,
    updatedAt: 100,
    author: { kind: "provider", providerId: "codex" },
    origin: {
      kind: "agent_run",
      runId: "agr_test",
      sessionId: "ses_test",
      alert: { eventId: "aev_test", ruleId: "arl_test" },
    },
    content: [{ type: "text", text: "Analysis" }],
    quotedPostId: null,
    ...overrides,
  } as Post;
}
function mount(value: Post, quotedPost: Post | null = null) {
  const read = vi.fn();
  const files: Record<string, { mime: string; filename: string }> = {
    pmd_pdf: { mime: "application/pdf", filename: "review.pdf" },
    pmd_audio: { mime: "audio/mp4", filename: "summary.m4a" },
  };
  const media = vi.fn().mockImplementation(({ id }: { id: string }) =>
    Promise.resolve({
      id,
      ...(files[id] ?? { mime: "image/png", filename: "chart.png" }),
      base64: "YWJj",
    }),
  );
  const transport = {
    url: "test",
    rpc: { resources: { post: { media: { query: media } } } },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <PostCard
        item={{ post: value, quotedPost }}
        transport={transport}
        unread
        onRead={read}
        renderReference={({ resource, id, label }) => (
          <a href={`/app/${resource}/${id}`}>{label}</a>
        )}
        renderResource={(resource) =>
          resource.resource === "alert_event" ? null : (
            <a href={`/app/alerts/rules/${resource.id}`}>Resource reference</a>
          )
        }
      />
    </QueryClientProvider>,
  );
  return { ...view, read, media };
}

test("renders text before one carousel of media and resources, and a current quote, without executable Markdown", async () => {
  const value = post({
    quotedPostId: "pst_rule" as Post["id"],
    content: [
      {
        type: "text",
        text: '**Conclusion** <script>window.bad=true</script><img src=x onerror="bad()"><a href="javascript:bad()">unsafe</a>',
      },
      { type: "media", mediaId: imageId, description: "Price movement" },
      { type: "text", text: "## After the chart" },
      { type: "resource", resource: "alert_rule", id: "arl_test" },
    ] as Post["content"],
  });
  const view = mount(
    value,
    post({
      content: [{ type: "text", text: "## Current quoted body" }],
    }),
  );
  const article = screen.getByRole("article");
  const image = await screen.findByRole("img", { name: "Price movement" });
  // eslint-disable-next-line testing-library/no-node-access -- Security regression checks forbidden markup, which has no accessible role.
  expect(article.querySelector("script")).toBeNull();
  // eslint-disable-next-line testing-library/no-node-access -- Security regression checks forbidden markup, which has no accessible role.
  expect(article.querySelector("[onerror]")).toBeNull();
  // eslint-disable-next-line testing-library/no-node-access -- Security regression checks forbidden markup, which has no accessible role.
  expect(article.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(screen.queryByText("Price movement")).not.toBeInTheDocument();
  expect(
    screen
      .getByRole("heading", { name: "After the chart" })
      .compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const attachments = screen.getByRole("region", { name: "Attachments" });
  expect(within(attachments).getByRole("img")).toBe(image);
  expect(
    within(attachments).getByRole("link", { name: "Resource reference" }),
  ).toBeVisible();
  expect(
    within(attachments).getByRole("button", { name: "Next slide" }),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("figure", { name: "Quoted post" })).getByRole(
      "heading",
      {
        name: "Current quoted body",
      },
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Mark read" }),
  ).not.toBeInTheDocument();
  fireEvent.click(article);
  expect(view.read).toHaveBeenCalledOnce();
  fireEvent.keyDown(article, { key: "Enter" });
  expect(view.read).toHaveBeenCalledTimes(2);
});

test("inline Resource references render through the host, in the Post and its quote", () => {
  mount(
    post({
      content: [
        {
          type: "text",
          text: "Crossed :resource[Price crossing]{name=alert_rule/alr_test} at the open.",
        },
      ] as Post["content"],
      quotedPostId: "pst_rule" as Post["id"],
    }),
    post({
      content: [
        { type: "text", text: "See :resource[Main]{name=dashboard/dsh_test}." },
      ],
    }),
  );
  expect(screen.getByRole("link", { name: "Price crossing" })).toHaveAttribute(
    "href",
    "/app/alert_rule/alr_test",
  );
  expect(
    within(screen.getByRole("figure", { name: "Quoted post" })).getByRole(
      "link",
      { name: "Main" },
    ),
  ).toHaveAttribute("href", "/app/dashboard/dsh_test");
  expect(screen.queryByText(/:resource\[/)).not.toBeInTheDocument();
});

test("like Bluesky, only images and video sit in the carousel; other files follow as downloads", async () => {
  mount(
    post({
      content: [
        { type: "text", text: "Review attached." },
        { type: "media", mediaId: imageId, description: "Trigger window" },
        { type: "media", mediaId: "pmd_pdf", description: "Review" },
        { type: "media", mediaId: "pmd_audio", description: "Summary" },
      ] as Post["content"],
    }),
  );
  const pdf = await screen.findByRole("link", { name: "review.pdf" });
  const audio = await screen.findByRole("link", { name: "summary.m4a" });
  const attachments = screen.getByRole("region", { name: "Attachments" });
  expect(within(attachments).getByRole("img")).toBeVisible();
  expect(attachments).not.toContainElement(pdf);
  expect(attachments).not.toContainElement(audio);
  // One visual slide left, so no arrows.
  expect(
    within(attachments).queryByRole("button", { name: "Next slide" }),
  ).not.toBeInTheDocument();
  expect(
    attachments.compareDocumentPosition(pdf) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("media-only posts, hidden resources and missing quoted posts", async () => {
  mount(
    post({
      content: [
        { type: "media", mediaId: imageId, description: "Chart only" },
        { type: "resource", resource: "alert_event", id: "aev_test" },
      ] as Post["content"],
      quotedPostId: "pst_missing" as Post["id"],
    }),
  );
  expect(await screen.findByRole("img", { name: "Chart only" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Next slide" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Resource reference" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("The quoted post is no longer available."),
  ).toBeVisible();
});

test("search, unread filters and pagination reach the backend together in a POST body", async () => {
  const query = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  const transport = {
    url: "test",
    rpc: { resources: { post: { feed: { query } } } },
  } as unknown as AppTransport;
  const read = { lastReadAt: 50, readIds: ["pst_read"] };
  const options = postFeedQueryOptions(transport, read, "AAPL");
  const signal = new AbortController().signal;
  await (
    options.queryFn as (context: {
      pageParam: string;
      signal: AbortSignal;
    }) => Promise<unknown>
  )({ pageParam: "next", signal });
  expect(query).toHaveBeenCalledWith(
    {
      limit: 20,
      cursor: "next",
      search: "AAPL",
      unread: { after: 50, excludeIds: ["pst_read"] },
    },
    { signal, context: { method: "POST" } },
  );
  expect(isPostUnread(read, { id: "pst_new", createdAt: 100 })).toBe(true);
  expect(isPostUnread(read, { id: "pst_read", createdAt: 100 })).toBe(false);
  expect(isPostUnread(read, { id: "pst_old", createdAt: 50 })).toBe(false);
});
