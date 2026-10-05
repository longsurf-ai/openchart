// Purpose: Effect schemas and TypeScript types for all drawing primitives (freehand, lines, shapes, text, Fibonacci tools) and drawing state
// Module:  @openchart/chart-core / drawing

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { Effect, Schema, Struct } from "effect";
import { Data } from "@openchart/chart-core/data/schema";
import { UUID } from "@openchart/chart-core/util";

export namespace Drawing {
  export const Type = Schema.Literals([
    "trend_line",
    "ray",
    "extended_line",
    "horizontal_line",
    "horizontal_ray",
    "vertical_line",
    "cross_line",
    "parallel_channel",
    "rectangle",
    "ellipse",
    "circle",
    "triangle",
    "polyline",
    "curved_line",
    "text",
    "fib_retracement",
    "fib_extension",
    "fib_channel",
    "freehand",
    "agent_session",
    "annotation",
    "volume_profile",
  ]);
  export type Type = typeof Type.Type;

  export const Anchor = Schema.Struct({
    time: Data.Time,
    price: Schema.Finite,
    axisId: Schema.optional(Schema.String),
  }).mapFields(Struct.map(Schema.mutableKey));
  export type Anchor = typeof Anchor.Type;

  export const LineStyle = Schema.Literals(["solid", "dashed", "dotted"]);
  export type LineStyle = typeof LineStyle.Type;

  export const Cap = Schema.Literals(["none", "dot", "arrow"]);
  export type Cap = typeof Cap.Type;

  export const Style = Schema.Struct({
    lineColor: Schema.String.pipe(
      Schema.withDecodingDefault(Effect.succeed("#000000")),
    ),
    lineWidth: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
      Schema.withDecodingDefault(Effect.succeed(1)),
    ),
    lineStyle: LineStyle.pipe(
      Schema.withDecodingDefault(Effect.succeed("solid")),
    ),
    fillColor: Schema.optional(Schema.String),
    textColor: Schema.String.pipe(
      Schema.withDecodingDefault(Effect.succeed("#000000")),
    ),
    fontSize: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(8)).pipe(
      Schema.withDecodingDefault(Effect.succeed(12)),
    ),
    opacity: Schema.Finite.check(
      Schema.isBetween({ minimum: 0, maximum: 1 }),
    ).pipe(Schema.withDecodingDefault(Effect.succeed(1))),
    startCap: Cap.pipe(Schema.withDecodingDefault(Effect.succeed("none"))),
    endCap: Cap.pipe(Schema.withDecodingDefault(Effect.succeed("none"))),
    middlePoint: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
    ),
    priceLabels: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
    ),
  }).mapFields(Struct.map(Schema.mutableKey));
  export type Style = typeof Style.Type;

  const Base = Schema.Struct({
    id: Schema.String,
    type: Type,
    name: Schema.optional(Schema.String),
    anchors: Schema.Array(Anchor).pipe(Schema.mutable),
    style: Style.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    locked: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
    ),
    hidden: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
    ),
  }).mapFields(Struct.map(Schema.mutableKey));

  export const LineItem = Schema.Struct({
    ...Base.fields,
    type: Schema.Literals([
      "trend_line",
      "ray",
      "extended_line",
      "horizontal_line",
      "horizontal_ray",
      "vertical_line",
      "cross_line",
      "parallel_channel",
      "fib_retracement",
      "fib_extension",
      "fib_channel",
      "polyline",
      "curved_line",
      "freehand",
    ]),
    text: Schema.optional(Schema.String),
  }).mapFields(Struct.map(Schema.mutableKey));
  export type LineItem = typeof LineItem.Type;

  export const ShapeItem = Schema.Struct({
    ...Base.fields,
    type: Schema.Literals(["rectangle", "ellipse", "circle", "triangle"]),
  }).mapFields(Struct.map(Schema.mutableKey));
  export type ShapeItem = typeof ShapeItem.Type;

  export const TextItem = Schema.Struct({
    ...Base.fields,
    type: Schema.Literal("text"),
    text: Schema.String.pipe(
      Schema.withDecodingDefault(Effect.succeed("Text")),
    ),
  }).mapFields(Struct.map(Schema.mutableKey));
  export type TextItem = typeof TextItem.Type;

  /** A time-located explanation with automatic or user-positioned label placement. */
  export const AnnotationItem = Schema.Struct({
    ...Struct.omit(Base.fields, ["name"]),
    type: Schema.Literal("annotation"),
    /** The leader target is derived from event time, never supplied as drawing anchors. */
    anchors: Schema.Tuple([]).pipe(Schema.mutable),

    /** Event instant in Unix epoch seconds, independent of chart resolution. */
    time: Data.Time,
    /** User-dragged label centroid; absent until the user overrides automatic placement. */
    labelAnchor: Schema.optional(Anchor),
    /** Short title used by the compact label and expanded card. */
    title: Schema.String.check(Schema.isMinLength(1)),
    /** Explanation shown in the expanded card. */
    body: Schema.String.check(Schema.isMinLength(1)),
    /** Supporting links; an empty array means no external sources are cited. */
    sources: Schema.Array(
      Schema.Struct({
        title: Schema.String.check(Schema.isMinLength(1)),
        url: Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/i)),
      }).mapFields(Struct.map(Schema.mutableKey)),
    ).pipe(Schema.mutable),
    /** Directional assessment from negative (-1) through neutral (0) to positive (1). */
    sentiment: Schema.Finite.check(
      Schema.isBetween({ minimum: -1, maximum: 1 }),
    ),
  })
    .mapFields(Struct.map(Schema.mutableKey))
    .annotate({ parseOptions: { onExcessProperty: "error" } });
  export type AnnotationItem = typeof AnnotationItem.Type;

  /** A range in epoch milliseconds. No price anchors or execution state are persisted. */
  export const AgentSessionItem = Schema.Struct({
    ...Base.fields,
    type: Schema.Literal("agent_session"),
    anchors: Schema.Tuple([]).pipe(Schema.mutable),
    range: Schema.Struct({ from: Schema.Finite, to: Schema.Finite })
      .mapFields(Struct.map(Schema.mutableKey))
      .check(
        Schema.makeFilter(({ from, to }) =>
          from <= to ? undefined : "Range must be ordered",
        ),
      ),
  }).mapFields(Struct.map(Schema.mutableKey));
  export type AgentSessionItem = typeof AgentSessionItem.Type;

  /**
   * The bars from the first anchor's time up to the second's, whose volume
   * profile the chart draws. The anchors' prices only place their handles.
   */
  export const VolumeProfileItem = Schema.Struct({
    ...Base.fields,
    type: Schema.Literal("volume_profile"),
  }).mapFields(Struct.map(Schema.mutableKey));
  export type VolumeProfileItem = typeof VolumeProfileItem.Type;

  /** Render-only projection of an active Session; absence means no scan. */
  export const SessionProgress = Schema.Struct({
    startedAtMs: Schema.Finite,
    progressLog: Schema.Array(
      Schema.Struct({ text: Schema.String, atMs: Schema.Finite }).mapFields(
        Struct.map(Schema.mutableKey),
      ),
    ).pipe(Schema.mutable),
  }).mapFields(Struct.map(Schema.mutableKey));
  export type SessionProgress = typeof SessionProgress.Type;

  export const Item = Schema.Union([
    LineItem,
    ShapeItem,
    TextItem,
    AgentSessionItem,
    AnnotationItem,
    VolumeProfileItem,
  ]);
  export type Item = typeof Item.Type;

  /** Completed geometry accepted by persistence; Item also permits in-progress drafts. */
  export const SavedItem = Item.check(
    Schema.makeFilter((item) => {
      if (!item.id.length)
        return {
          path: ["id"],
          issue: "A saved drawing needs a non-empty identity",
        };
      const required = requiredAnchors(item.type);
      const variable = item.type === "freehand" || item.type === "polyline";
      if (
        variable
          ? item.anchors.length < required
          : item.anchors.length !== required
      )
        return {
          path: ["anchors"],
          issue: `${item.type} requires ${variable ? "at least" : "exactly"} ${required} anchors`,
        };
      if (required < 2) return undefined;
      const first = item.anchors[0]!;
      const second = item.anchors[1]!;
      const sameTime = (anchor: Anchor) => anchor.time === first.time;
      const samePoint = (anchor: Anchor) =>
        sameTime(anchor) &&
        anchor.price === first.price &&
        anchor.axisId === first.axisId;
      if (
        item.type === "rectangle" ||
        item.type === "ellipse" ||
        item.type === "triangle"
      ) {
        if (sameTime(second) || first.price === second.price)
          return {
            path: ["anchors", 1],
            issue: `${item.type} requires distinct times and prices to define a non-zero area`,
          };
      } else if (item.type === "volume_profile") {
        if (sameTime(second))
          return {
            path: ["anchors", 1, "time"],
            issue: `${item.type} requires distinct start and end times to define its bars`,
          };
      } else if (
        item.type === "fib_retracement" ||
        item.type === "fib_extension"
      ) {
        if (first.price === second.price)
          return {
            path: ["anchors", 1, "price"],
            issue: `${item.type} requires distinct first and second prices to define its levels`,
          };
      } else if (variable || item.type === "curved_line") {
        if (item.anchors.every(samePoint))
          return {
            path: ["anchors"],
            issue: `${item.type} requires at least two distinct points`,
          };
      } else if (samePoint(second)) {
        return {
          path: ["anchors", 1],
          issue: `${item.type} requires distinct first and second points`,
        };
      }
      return undefined;
    }),
  );

  export const State = Schema.Struct({
    selectedId: Schema.optional(Schema.String),
    hoveredId: Schema.optional(Schema.String),
    activeTool: Schema.optional(Schema.NullOr(Type)),
    toolLocked: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
    ),
    draft: Schema.optional(Item),
    symbolKey: Schema.optional(Schema.String),
    contextMenu: Schema.optional(
      Schema.Struct({
        id: Schema.String,
        x: Schema.Finite,
        y: Schema.Finite,
      }).mapFields(Struct.map(Schema.mutableKey)),
    ),
    configId: Schema.optional(Schema.String),
    sessionProgress: Schema.optional(
      Schema.Record(Schema.String, Schema.mutableKey(SessionProgress)),
    ),
  }).mapFields(Struct.map(Schema.mutableKey));
  // Items are a render/hit-test projection of Chart.State.objects, never a
  // second collection installed on the stored interaction state.
  export type State = typeof State.Type;
  /** Ephemeral renderer/hit-test input; items are derived from chart objects. */
  export type RenderInput = State & { items: readonly Item[] };

  export function createState(): State {
    return Schema.decodeUnknownSync(State)({});
  }

  export function requiredAnchors(type: Type): number {
    switch (type) {
      case "agent_session":
      case "annotation":
        return 0;
      case "horizontal_line":
      case "horizontal_ray":
      case "vertical_line":
      case "cross_line":
      case "text":
        return 1;
      case "freehand":
        return 2;
      case "polyline":
      case "curved_line":
      case "parallel_channel":
      case "fib_extension":
      case "fib_channel":
        return 3;
      case "fib_retracement":
        return 2;
      default:
        return 2;
    }
  }

  export function create(
    type: Type,
    anchors: Anchor[],
    options?: Omit<Partial<Item>, "style"> &
      Partial<
        Pick<
          AnnotationItem,
          "time" | "title" | "body" | "sources" | "sentiment" | "labelAnchor"
        >
      > & { name?: string; style?: Partial<Style> },
  ): Item {
    const style = Schema.decodeUnknownSync(Style)({
      ...(options?.style ?? {}),
    });
    const base = {
      id: options?.id ?? UUID.random(),
      type,
      ...(options?.name === undefined ? {} : { name: options.name }),
      anchors,
      style,
      locked: options?.locked ?? false,
      hidden: options?.hidden ?? false,
    };

    if (type === "annotation") {
      return Schema.decodeUnknownSync(AnnotationItem)({
        ...base,
        time: options?.time,
        labelAnchor: options?.labelAnchor,
        title: options?.title,
        body: options?.body,
        sources: options?.sources,
        sentiment: options?.sentiment,
      });
    }

    if (type === "text") {
      return Schema.decodeUnknownSync(TextItem)({
        ...base,
        text: (options as Partial<TextItem> | undefined)?.text ?? "Text",
      });
    }

    if (type === "agent_session") {
      return Schema.decodeUnknownSync(AgentSessionItem)({
        ...base,
        range: (options as Partial<AgentSessionItem> | undefined)?.range,
      });
    }

    if (
      type === "rectangle" ||
      type === "ellipse" ||
      type === "circle" ||
      type === "triangle"
    ) {
      return Schema.decodeUnknownSync(ShapeItem)(base);
    }

    if (type === "volume_profile") {
      return Schema.decodeUnknownSync(VolumeProfileItem)(base);
    }

    return Schema.decodeUnknownSync(LineItem)({
      ...base,
      text: (options as Partial<LineItem> | undefined)?.text,
    });
  }

  export function normalize(item: Item): Item {
    return Schema.decodeUnknownSync(Item)(item);
  }
}
