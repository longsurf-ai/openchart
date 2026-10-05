// Purpose: Registers read-only Post queries; trusted publication remains an internal operation.
import { defineResource } from "@openchart/server/lib/resource/definition";
import { PostEntity, POST_CHARACTER_LIMIT } from "./entity";
import { postStore } from "./store";
import { feed } from "./transitions/feed";
import { media } from "./transitions/media";
import { byAlertEvent } from "./transitions/by-alert-event";
import { unreadCounts } from "./transitions/unread-counts";
import { publishedRuns } from "./transitions/published-runs";

export { PostEntity } from "./entity";
export { alertEventPostContent } from "./alert-event-content";
export { publishPost } from "./transitions/publish";
export { lookupPublishedPost } from "./transitions/lookup-published-post";
export {
  PostId,
  PostMediaId,
  PostContent,
  type PostPublication,
} from "./schema";

/** Published content shared by Feeds; public callers cannot forge publication provenance.
 * @example const page = yield* Transactor.run(postResource.transitions.feed({limit: 20}));
 */
export const postResource = defineResource({
  name: "post",
  description: `A Feed Post with Markdown, media, Resource references and an optional quote. Publish with publish_post. Max ${POST_CHARACTER_LIMIT} Unicode characters across text and media descriptions, including Markdown syntax and whitespace.`,
  readOnly: true,
  entity: PostEntity,
  store: postStore,
  transitions: { feed, media, byAlertEvent, unreadCounts, publishedRuns },
});
/** Complete published Post returned by Resource reads. */
export type Post = typeof postResource.entity.Type;
