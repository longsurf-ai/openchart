// Purpose: Effect schemas and types for dashboard/listing-scoped Explain annotation records
// Module:  @openchart/chart-core / annotation

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { Effect, Schema, Struct } from "effect";
import { ProviderListing } from "@openchart/market";
import { Data } from "@openchart/chart-core/data";
import { Drawing } from "@openchart/chart-core/drawing/types";
import type {
  AnnotationExpandedCardContent,
  AnnotationSourceBadge,
} from "./appearance";

export namespace ChartAnnotation {
  /** Transient card disclosure. Clearing it closes both the card and its full body. */
  export type Expansion = { id: string; body: "preview" | "full" };

  export const DEFAULT_LINE_COLOR = "var(--chart-annotation-border, #f59e0b)";
  export const DEFAULT_FILL_COLOR = "var(--chart-annotation-fill, #111827)";
  export const DEFAULT_TEXT_COLOR = "var(--chart-annotation-text, #f8fafc)";
  export const DEFAULT_FONT_SIZE = 12;

  export const Visibility = Schema.Literals(["visible", "collapsed", "hidden"]);
  export type Visibility = typeof Visibility.Type;

  export const Feedback = Schema.Literals(["approved", "rejected"]);
  export type Feedback = typeof Feedback.Type;

  export const ChartPointAnchor = Drawing.Anchor;
  export type ChartPointAnchor = typeof ChartPointAnchor.Type;

  export const Style = Schema.Struct({
    ...Drawing.Style.fields,
    lineColor: Schema.String.pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_LINE_COLOR)),
    ),
    lineWidth: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
      Schema.withDecodingDefault(Effect.succeed(1)),
    ),
    lineStyle: Drawing.LineStyle.pipe(
      Schema.withDecodingDefault(Effect.succeed("solid")),
    ),
    fillColor: Schema.String.pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_FILL_COLOR)),
    ),
    textColor: Schema.String.pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_TEXT_COLOR)),
    ),
    fontSize: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(8)).pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_FONT_SIZE)),
    ),
    opacity: Schema.Finite.check(
      Schema.isBetween({ minimum: 0, maximum: 1 }),
    ).pipe(Schema.withDecodingDefault(Effect.succeed(1))),
  }).mapFields(Struct.map(Schema.mutableKey));
  export type Style = typeof Style.Type;

  export const Anchor = Schema.Struct({
    start: Data.Time,
    end: Schema.optional(Data.Time),
    targetAnchor: Schema.optional(ChartPointAnchor),
    labelAnchor: Schema.optional(ChartPointAnchor),
  })
    .mapFields(Struct.map(Schema.mutableKey))
    .annotate({ parseOptions: { onExcessProperty: "error" } });
  export type Anchor = typeof Anchor.Type;

  export const Sentiment = Schema.Finite.check(
    Schema.isBetween({ minimum: -1, maximum: 1 }),
  );
  export type Sentiment = typeof Sentiment.Type;

  export const Record = Schema.Struct({
    id: Schema.String,
    userId: Schema.String,
    dashboardId: Schema.String,
    market: ProviderListing,
    spanId: Schema.NullOr(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed(null)),
    ),
    materializedByAgentRunId: Schema.NullOr(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed(null)),
    ),
    materializationKey: Schema.NullOr(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed(null)),
    ),
    eventId: Schema.String,
    label: Schema.String.check(Schema.isMinLength(1)),
    sentiment: Sentiment,
    priorityScore: Schema.Finite,
    anchor: Anchor,
    style: Style,
    visibility: Visibility,
    feedback: Schema.NullOr(Feedback).pipe(
      Schema.withDecodingDefault(Effect.succeed(null)),
    ),
    revision: Schema.Int,
    createdAt: Schema.String,
    updatedAt: Schema.String,
    deletedAt: Schema.optional(Schema.NullOr(Schema.String)),
  }).mapFields(Struct.map(Schema.mutableKey));
  export type Record = typeof Record.Type;

  /** Layout and paint consume geometry and content, independent of persistence ownership. */
  export type Renderable = Pick<
    Record,
    | "id"
    | "label"
    | "sentiment"
    | "priorityScore"
    | "anchor"
    | "style"
    | "visibility"
  > & {
    eventId?: string;
    content?: AnnotationExpandedCardContent;
    sourceBadges?: readonly AnnotationSourceBadge[];
  };
}
