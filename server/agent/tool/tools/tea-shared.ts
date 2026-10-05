// Purpose: Share Agent Tea source selection, path resolution, the config guide and compiled definitions.
import { isAbsolute, resolve } from "node:path";
import { Effect, Schema } from "effect";

import { ProviderId } from "@openchart/market";
import { Session } from "@openchart/server/agent/session";
import type * as Tool from "@openchart/server/agent/tool/tool";
import * as Tea from "@openchart/tea";
import { compileToProgram, Errors } from "tea/compiler";
import { TeaCompileError } from "tea";
import { assertTrue } from "@openchart/utils/assert";

/** Flat source fields keep both Tea tools compatible with native tool SDKs. */
export const TeaSourceFields = {
  path: Schema.optionalKey(Schema.NonEmptyString),
  source: Schema.optionalKey(Schema.NonEmptyString),
};

/** Require exactly one source while retaining each tool's other typed fields.
 * @example Schema.Struct(TeaSourceFields).pipe(Schema.refine(hasTeaSource));
 */
export function hasTeaSource<
  T extends { readonly path?: string; readonly source?: string },
>(
  input: T,
): input is T &
  (
    | ({ readonly path: string } & { readonly source?: never })
    | ({ readonly source: string } & { readonly path?: never })
  ) {
  return (input.path === undefined) !== (input.source === undefined);
}

/** Resolve files against the executing Assistant, never the server process cwd.
 * Reads no source; callers must authorize the resolved path before compilation.
 * @example const request = yield* resolveTeaSource(input, context);
 */
export const resolveTeaSource = Effect.fn("TeaTool.resolveSource")(function* (
  input: { readonly path: string } | { readonly source: string },
  context: Tool.Context,
) {
  if (!("path" in input)) return { source: input.source };
  let path = input.path;
  if (!isAbsolute(path)) {
    const message = yield* (yield* Session.Service).getMessage({
      sessionID: context.sessionID,
      messageID: context.messageID,
    });
    assertTrue(
      message?.info.role === "assistant",
      "Tea tools require the executing Assistant",
    );
    assertTrue(
      isAbsolute(message.info.path.cwd),
      "Assistant cwd must be absolute",
    );
    path = resolve(message.info.path.cwd, path);
  }
  return { path };
});

/**
 * A NodeConfig that reads one Bars series (AAPL one-minute bars from
 * yfinance) in the JSON form the tools accept: one input that lists every
 * Bars column, and a map that reads each column by name. Tool descriptions
 * and `docs/agent/tea.md` show exactly this JSON.
 * @example JSON.stringify(teaConfigExample);
 */
export const teaConfigExample: Tea.NodeConfigEncoded = Schema.encodeSync(
  Tea.NodeConfig,
)({
  ...Tea.barsInputs({
    provider: ProviderId.make("yfinance"),
    listing: { symbol: "AAPL", currency: "USD" },
    resolution: "1m",
    session: "regular",
    adjustment: "split",
  }),
  parameters: {},
  requests: {},
});

/** What `config` means, shared by the tea_check and tea_run descriptions. */
export const teaConfigDescription = [
  "config is a NodeConfig {inputs, map, parameters, requests} in JSON.",
  "inputs names each data source. A Bars input reads a Feed series (provider, listing, resolution, session, adjustment) and lists its columns in schema, an Arrow JSON schema: open, high, low, close and volume are required, hl2, hlc3, ohlc4 and hlcc4 are optional, and each is a floatingpoint DOUBLE as in the example below.",
  'map says where each column the script reads comes from, as column: [input name, field path], such as close: ["bars", ["close"]]. Every column the script reads with these parameters must be listed; extra columns are fine.',
  'parameters gives every declared parameter by its declaration name; one tea_check marks chartDefault may be left out to take its default for the Bars input\'s chart, such as an auto script\'s timeframe, which names the finer bars to read as a Pine timeframe such as "60", or "" to let the service pick.',
  'requests may hold a complete NodeConfig per request.security child, keyed by its name, with its own inputs. A child left out reads Bars of the listing its line names: write the symbol as a ticker id, provider:symbol such as request.security("binance:ETHUSDT", "D", close), or syminfo.tickerid for the script\'s own listing; "" keeps the script\'s timeframe. The provider looks the symbol up, so the listing must exist there.',
  "A NodeRef input is rejected, because these tools run no other nodes.",
  `For one Bars series, copy this and change the series fields: ${JSON.stringify(teaConfigExample)}`,
].join(" ");

/**
 * The compiled Definition as JSON, plus the names of its alert outputs. Its
 * schemas use Arrow's JSON form, the same form a config's input schemas use,
 * so the Agent reads and writes one JSON shape.
 * @example const { definition, alertOutputs } = describeTea(node.definition);
 */
export function describeTea(definition: Tea.Definition) {
  return {
    definition: Schema.encodeSync(Tea.Definition)(definition),
    alertOutputs: Tea.teaAlertOutputs(definition.outputs),
  };
}

/** Read an authorized path through Tea's dependency resolver; inline text has no disk access.
 * @example const request = yield* compilationSource(source);
 */
export const compilationSource = Effect.fn("TeaTool.compilationSource")(
  function* (input: { readonly path: string } | { readonly source: string }) {
    return yield* Effect.try({
      try: () => {
        if ("source" in input)
          return { entry: "<inline>", sources: { "<inline>": input.source } };
        const errors = new Errors();
        // ponytail: compile authorized paths to capture imports before the service's snapshot input;
        // reuse compiler results if this extra compilation becomes a measured bottleneck.
        const result = compileToProgram([input.path], errors, {
          includeSources: true,
        });
        if (!result) throw new TeaCompileError(errors.flushErrors());
        return { entry: input.path, sources: result.sources };
      },
      catch: (cause) =>
        new Tea.Error(
          {
            code: "compile_failed",
            message:
              cause instanceof Error
                ? cause.message
                : "Tea source could not be read",
          },
          { cause },
        ),
    });
  },
);
