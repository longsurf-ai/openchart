// Purpose: Adapt live Tea alert outputs into source-neutral occurrences with scoped cleanup.
import { isDeepStrictEqual } from "node:util";
import { barsSeries, type BarsSeries } from "@openchart/feed";
import * as Tea from "@openchart/server/tea/tea";

import { Clock, Effect, Schema, Stream } from "effect";

import type { Alertable, AlertOccurrence, Evaluation } from "./alertable";
import { alertStarterWarmup } from "./starters";
import { conditionWarmup } from "./conditions";

const decodeInputPath = Schema.decodeUnknownEffect(Schema.Array(Schema.String));

const decodeAlerts = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      title: Schema.String,
      message: Schema.String,
      data: Schema.optional(Schema.JsonObject),
    }),
  ),
);

// The one series every Bars input of a node reads, or undefined when there is
// none or they differ. A NodeRef input names no market.
function marketOf(config: Tea.NodeConfig): BarsSeries | undefined {
  const [first, ...rest] = Object.values(config.inputs).flatMap((input) =>
    input._tag === "Bars" ? [barsSeries(input, input)] : [],
  );
  return rest.every((series) => isDeepStrictEqual(series, first))
    ? first
    : undefined;
}

const aliases = (market: BarsSeries): Schema.JsonObject => ({
  symbol: market.listing.symbol,
  provider: market.provider,
  resolution: market.resolution,
});

const invalidData = (message: string) => (cause: unknown) =>
  new Tea.Error({ code: "invalid_data", message }, { cause });

/**
 * One inline Tea definition. Construction is inert; each consumer owns an
 * independent compilation, warmed observation, and disposal. Only live updates
 * fire, including provisional attempts; snapshots and restarts never replay.
 */
export class TeaAlerts implements Alertable<
  Evaluation<Schema.JsonObject>,
  Tea.Error,
  Tea.Service
> {
  /** @example const source = new TeaAlerts({ source: script, config }); */
  constructor(
    private readonly definition: {
      readonly source: string;
      /** How to run the script. */
      readonly config: Tea.NodeConfig;
      /** Other compiled scripts the config reads through NodeRef inputs; none by default. */
      readonly nodes?: Tea.ObserveRequest["nodes"];
      /** Drawing executions replay from their earliest anchor, independently of warmup. */
      readonly from?: number;
      /** A numeric output that must be 1 after history establishes every anchor. */
      readonly readyOutput?: string;
      /**
       * Bars needed before the window: a drawing (`readyOutput`) warms exactly
       * these; any other script at least these and {@link Tea.standardWarmupBars}.
       */
      readonly warmupBars?: number;
    },
  ) {}

  /**
   * Emit one element per completed evaluation: first `[]` for the warmed
   * snapshot (snapshots never fire), then each live row's occurrences, empty
   * when no condition holds. Consume typed alert columns. Legacy alerts retain scalar
   * row outputs. Explicit per-event payload takes precedence. Occurrence data
   * names the market the root's Bars inputs read in the run as `inputs`,
   * finer bars when the rule follows an auto Indicator. Root market
   * aliases are supplied only for a script without requests whose Bars inputs
   * read one market; others must emit their own identity. An explicit
   * `data.input` request-name path resolves authoritative subject aliases from
   * that binding's Bars inputs, with [] naming the root. Invalid paths fail the
   * stream. The caller owns the compilations in `nodes`; this script's
   * compilation and inputs are released even when decoding fails or the
   * consumer cancels.
   * @example yield* new TeaAlerts(definition).observe().pipe(Stream.runDrain);
   */
  observe(): Stream.Stream<
    Evaluation<Schema.JsonObject>,
    Tea.Error,
    Tea.Service
  > {
    const {
      source,
      config,
      nodes = {},
      from,
      readyOutput,
      warmupBars = 0,
    } = this.definition;
    return Stream.unwrap(
      Effect.gen(function* () {
        const tea = yield* Tea.Service;
        const node = yield* Effect.acquireRelease(
          tea.compile({ entry: "<inline>", sources: { "<inline>": source } }),
          (node) => Effect.ignore(tea.dispose({ id: node.id })),
        );
        const columns = Tea.teaAlertOutputs(node.definition.outputs);
        if (columns.length === 0) return Stream.empty;
        const written = node.definition.outputs.fields
          .filter((field) => field.metadata.has("tea:write"))
          .map((field) => field.name);
        const now = yield* Clock.currentTimeMillis;
        const {
          config: run,
          snapshot,
          updates = Stream.empty,
        } = yield* tea.observe({
          id: node.id,
          ...config,
          nodes,
          // A drawing entirely in the future still needs recent bars to
          // establish its ordinal projection before future anchors arrive.
          from:
            readyOutput && from !== undefined
              ? Math.min(from, now - 1)
              : (from ?? now - 1),
          to: "now",
          countBack: 1,
          warmupBars: readyOutput
            ? warmupBars
            : Math.max(
                Tea.standardWarmupBars,
                warmupBars,
                alertStarterWarmup(source, config.parameters),
                conditionWarmup(source, config.parameters),
              ),
        });
        // The market the run reads, such as an auto Indicator's finer bars.
        const market = marketOf(run);
        const identity =
          market && Object.keys(node.definition.requests).length === 0
            ? aliases(market)
            : {};
        if (
          readyOutput &&
          snapshot.data.get(snapshot.data.numRows - 1)?.[readyOutput] !== 1
        )
          return yield* Effect.fail(
            new Tea.Error({
              code: "invalid_data",
              message:
                "Drawing anchors could not be resolved in the available market history.",
            }),
          );
        const live = updates.pipe(
          Stream.flattenIterable,
          Stream.mapEffect(
            Effect.fn("TeaAlerts.decode")(function* (row) {
              if (readyOutput && row[readyOutput] !== 1)
                return yield* Effect.fail(
                  new Tea.Error({
                    code: "invalid_data",
                    message:
                      "Drawing geometry became unavailable or exceeded its numerical range.",
                  }),
                );
              const occurrences: AlertOccurrence<Schema.JsonObject>[] = [];
              const values = Object.fromEntries(
                written.flatMap((name) => {
                  const value = row[name];
                  return typeof value === "number" && Number.isFinite(value)
                    ? [[name, value]]
                    : [];
                }),
              );
              for (const condition of columns) {
                const alerts = yield* decodeAlerts(row[condition]).pipe(
                  Effect.mapError(
                    invalidData("Tea alert payload must be JSON-compatible"),
                  ),
                );
                for (const alert of alerts) {
                  let subject: Schema.JsonObject = {};
                  if (alert.data && Object.hasOwn(alert.data, "input")) {
                    const path = yield* decodeInputPath(alert.data.input).pipe(
                      Effect.mapError(
                        invalidData("Alert input must be a request-name path"),
                      ),
                    );
                    // The run's config also holds the children Tea filled in.
                    let binding: Tea.NodeConfig | undefined = run;
                    for (const name of path)
                      binding =
                        binding && Object.hasOwn(binding.requests, name)
                          ? binding.requests[name]
                          : undefined;
                    const named = binding && marketOf(binding);
                    if (!named)
                      return yield* Effect.fail(
                        new Tea.Error({
                          code: "invalid_data",
                          message: binding
                            ? `Alert input reads no single market: ${path.join(".")}`
                            : `Alert input does not exist: ${path.join(".")}`,
                        }),
                      );
                    subject = aliases(named);
                  }
                  occurrences.push({
                    condition,
                    time: row.time,
                    title: alert.title,
                    message: alert.message,
                    data: {
                      ...(market ? { inputs: market } : {}),
                      parameters: config.parameters,
                      values,
                      ...identity,
                      ...alert.data,
                      ...subject,
                    },
                  });
                }
              }
              return occurrences;
            }),
          ),
        );
        return Stream.concat(
          Stream.succeed<Evaluation<Schema.JsonObject>>([]),
          live,
        );
      }),
    );
  }
}
