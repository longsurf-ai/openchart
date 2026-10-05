# Published Posts

- Resource `post` owns publication, media and Feed filtering. Derive wire types
  from shared transport; no server runtime or other feature imports.
- `api/` owns queries under the Post Resource invalidation prefix. Unread and
  search filters run before cursor pagination; long read filters use POST bodies.
- Read marks are device-local Post IDs, separate from Alert-event marks. They
  never mutate published content or mark Agent execution complete.
- Cards use the shared theme tokens.
  Text renders first, in order; images, video and host-rendered Resources follow
  in one shared Carousel, then other files as downloads (Bluesky embeds only
  images and video), then the quote. Media-only Posts stay valid. Safe standalone
  Markdown belongs to shared UI; native media never interprets HTML.
  Descriptions are alt text only, never captions.
- Quotes render one current Post or a missing placeholder, never recurse. Like
  Bluesky embeds, their meta is one line: small avatar, author, time.
  App composition injects Resource attachments, inline references and
  Session/Rule/Prompt actions; opening never submits Agent work.
