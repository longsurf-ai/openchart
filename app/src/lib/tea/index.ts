// Purpose: Browser Tea compilation and cold observations over the application connection, plus the JSON forms of the configs the app writes.
import * as Tea from "@openchart/tea";
import { BarsSeries } from "@openchart/feed";
import { HoseError } from "@openchart/hose";
import { TRPCClientError } from "@trpc/client";
import { Result, Schema } from "effect";
import { catchError, defer, map, tap, throwError, type Observable } from "rxjs";

import type { AppTransport } from "@openchart/app/lib/transport/transport";

const decodeCompileResponse = Schema.decodeUnknownSync(Tea.CompileResponse);
const decodeMessage = Schema.decodeUnknownSync(Tea.Message);
const encodeChannelRequest = Schema.encodeResult(Tea.ChannelRequest);
const decodeDispose = Schema.decodeUnknownResult(Tea.DisposeRequest);
const isFailure = Schema.is(Tea.Failure);

/**
 * A {@link Tea.NodeConfig} as JSON text, to compare configs by value. Structs
 * and Arrow schemas encode canonically and records keep their key order, so a
 * config built again the same way gives the same text. Throws a schema error
 * for an invalid config.
 * @example writeNodeConfig({ ...Tea.barsInputs(series), parameters: {}, requests: {} });
 */
export const writeNodeConfig = Schema.encodeSync(
  Schema.fromJsonString(Tea.NodeConfig),
);

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
// The inputs and map of a node whose inputs are all Bars, as a stored alert rule's are.
const BarsInputs = Schema.Struct({
  inputs: Schema.Record(Schema.String, Tea.Bars),
  map: Tea.InputMap,
});
// barsInputs types its inputs as any NodeInput; encoding checks they are Bars.
const encodeBarsInputs = Schema.encodeUnknownSync(BarsInputs);
/**
 * {@link Tea.barsInputs} as JSON, for configs the app writes as JSON, such as
 * alert rules: an input named `bars` and a map that reads every Bars column
 * from it.
 * @example writeAlertConfig({ ...encodedBarsInputs(series), parameters, requests: {} });
 */
export const encodedBarsInputs = (series: BarsSeries) =>
  encodeBarsInputs(Tea.barsInputs(series));
// Decoding a Bars input's JSON as a series drops its `_tag` and `schema`.
const decodeBarsSeries = Schema.decodeSync(BarsSeries);
const sameSeries = Schema.toEquivalence(BarsSeries);

const { parameters, requests } = Tea.NodeConfig.fields;
/**
 * An alert rule's configuration. It is either a NodeConfig whose inputs are
 * all Bars, or `{indicatorId, parameters, requests}`, which follows a chart
 * Indicator: the server then runs the rule on that Indicator's chart market
 * and reads its outputs as `indicator.<name>`. Request children always name
 * their own inputs. It mirrors the server's `AlertRuleRunConfig`.
 */
const AlertConfig = Schema.Union([
  Schema.Struct({
    ...BarsInputs.fields,
    parameters,
    requests,
  }).annotate(strict),
  Schema.Struct({
    // The server's Indicator ID rule.
    indicatorId: Schema.String.check(Schema.isStartsWith("ind_")),
    parameters,
    requests,
  }).annotate(strict),
]);
/** An alert rule's configuration as JSON: what the alert rule Resource stores and the editor edits. */
export type AlertConfig = typeof AlertConfig.Encoded;
/**
 * The market an alert rule reads, found as the server finds the market it
 * records for the rule's events: the one series every root Bars input reads.
 * Undefined when the rule follows an Indicator, has no Bars input yet, or its
 * Bars inputs read different series.
 * @example const market = alertConfigMarket(rule.alertable.config);
 */
export function alertConfigMarket(config: AlertConfig): BarsSeries | undefined {
  if (!("inputs" in config)) return;
  const [first, ...rest] = Object.values(config.inputs).map((input) =>
    decodeBarsSeries(input),
  );
  return first && rest.every((series) => sameSeries(first, series))
    ? first
    : undefined;
}
const alertConfigJson = Schema.fromJsonString(AlertConfig, { space: 2 });
/**
 * Read alert configuration JSON text. Throws a schema error when the text is
 * not JSON or not a complete configuration. The result is canonical, like the
 * stored form, so reading what {@link writeAlertConfig} printed gives back an
 * equal configuration.
 * @example const config = readAlertConfig(text);
 */
export const readAlertConfig = (text: string): AlertConfig =>
  Schema.encodeSync(AlertConfig)(
    Schema.decodeUnknownSync(alertConfigJson)(text),
  );
/**
 * Print an alert configuration as indented JSON text, with every child
 * binding. Struct fields and Arrow schemas print canonically and records keep
 * their key order, so comparing texts tells whether a draft changed.
 * @example const text = writeAlertConfig(rule.alertable.config);
 */
export const writeAlertConfig = (config: AlertConfig): string =>
  Schema.encodeSync(alertConfigJson)(Schema.decodeSync(AlertConfig)(config));

/** Cancels this operation; observation cancellation never disposes the compiled ID. */
export type RequestOptions = { readonly signal?: AbortSignal };

function teaError(error: unknown, signal?: AbortSignal): Tea.Error {
  if (signal?.aborted)
    return new Tea.Error(
      { code: "cancelled", message: "Tea request cancelled" },
      { cause: signal.reason },
    );
  if (error instanceof Tea.Error) return error;
  if (Schema.isSchemaError(error))
    return new Tea.Error({
      code: "invalid_data",
      message: "Invalid Tea response",
    });
  if (error instanceof Error && error.name === "AbortError")
    return new Tea.Error({
      code: "cancelled",
      message: "Tea request cancelled",
    });
  // The server's public failure: tRPC `data.error` or a Hose `failed` body.
  const failure: unknown =
    error instanceof HoseError
      ? error.body
      : error instanceof TRPCClientError
        ? error.data?.error
        : undefined;
  if (isFailure(failure)) return new Tea.Error(failure);
  return new Tea.Error(
    { code: "upstream", message: "Tea connection failed" },
    { cause: error },
  );
}

/**
 * Creates lazy Tea access using the application's shared RPC and Hose clients.
 * Each observation subscriber owns one channel and receives decoded messages.
 * Consumers choose how to display or retain them; there is no replay or restart.
 * Closing this client stops observations, drains compilations and disposes its node IDs.
 * @example const tea = createTeaClient(transport); const compiled = await tea.compile({workspaceId, path});
 */
export function createTeaClient(transport: AppTransport) {
  const lifetime = new AbortController();
  const hose = transport.hose;
  // Supported browsers provide any(); the app's DOM declarations predate it.
  const nativeSignal = AbortSignal as typeof AbortSignal & {
    any(signals: AbortSignal[]): AbortSignal;
  };
  const signalFor = (options: RequestOptions): AbortSignal =>
    options.signal
      ? nativeSignal.any([lifetime.signal, options.signal])
      : lifetime.signal;
  const nodes = new Set<string>();
  const compiling = new Set<Promise<Tea.CompileResponse>>();
  const disposing = new Map<string, Promise<void>>();
  let closing: Promise<void> | undefined;
  const dispose = (
    request: Tea.DisposeRequest,
    options: RequestOptions = {},
  ): Promise<void> => {
    const parsed = decodeDispose(request);
    if (Result.isFailure(parsed))
      return Promise.reject(
        new Tea.Error({
          code: "invalid_request",
          message: parsed.failure.message,
        }),
      );
    const { id } = parsed.success;
    const existing = disposing.get(id);
    if (existing) return existing;
    // Release is allowed after admission closes and never uses the aborted client signal.
    const pending = transport.rpc.tea.dispose
      .mutate({ id }, { signal: options.signal })
      .then(() => {
        nodes.delete(id);
      })
      .catch((error) => {
        throw teaError(error, options.signal);
      });
    disposing.set(id, pending);
    void pending.then(
      () => disposing.delete(id),
      () => disposing.delete(id),
    );
    return pending;
  };
  return {
    /** The backend this client talks to; cached reads key on it, as the Workspace keys do. */
    url: transport.url,
    /** Retain a compiled script until dispose or client shutdown. The source is a Workspace
     * file or complete `{entry, sources}` content. Cancellation waits for the response and
     * releases its ID; it must not discard a successful server allocation.
     * @example const compiled = await tea.compile({entry: "sma.tea", sources});
     */
    compile: (
      request: Tea.CompileRequest,
      options: RequestOptions = {},
    ): Promise<Tea.CompileResponse> => {
      const signal = signalFor(options);
      if (signal.aborted)
        return Promise.reject(teaError(signal.reason, signal));
      const pending = (async () => {
        // Do not abort this HTTP request: its response identifies the resource to release.
        const encoded = await transport.rpc.tea.compile.mutate(request);
        // Retain the validated ID even if decoding the rest of the metadata fails.
        const identity = Schema.decodeUnknownSync(Tea.DisposeRequest)({
          id: encoded.id,
        });
        nodes.add(identity.id);
        let compiled: Tea.CompileResponse;
        try {
          compiled = decodeCompileResponse(encoded);
          signal.throwIfAborted();
        } catch (error) {
          await dispose(identity);
          throw error;
        }
        return compiled;
      })().catch((error) => {
        throw teaError(error, signal);
      });
      compiling.add(pending);
      void pending.then(
        () => compiling.delete(pending),
        () => compiling.delete(pending),
      );
      return pending;
    },
    /** Read a Workspace script with every file its imports reach, as content `compile`
     * accepts. Retains nothing; a missing or non-compiling file fails with `compile_failed`.
     * @example const source = await tea.snapshot({workspaceId, path});
     */
    snapshot: (request: Tea.WorkspaceSources, options: RequestOptions = {}) => {
      const signal = signalFor(options);
      return transport.rpc.tea.snapshot
        .query(request, { signal })
        .catch((error: unknown) => {
          throw teaError(error, signal);
        });
    },
    /** Opens one independent execution per subscriber; unsubscribe closes only that channel.
     * An invalid request fails with `invalid_request` before any channel opens.
     * @example const subscription = tea.observe(request).subscribe({next: consume});
     */
    observe: (
      request: Tea.ObserveRequest,
      options: RequestOptions = {},
    ): Observable<Tea.Message> =>
      defer(() => {
        const signal = signalFor(options);
        if (signal.aborted) throw teaError(signal.reason, signal);
        // The request holds Arrow schemas and Hose sends JSON, so send its JSON form.
        const encoded = encodeChannelRequest({ type: "tea.open", request });
        if (Result.isFailure(encoded))
          throw new Tea.Error({
            code: "invalid_request",
            message: encoded.failure.message,
          });
        let receivedSnapshot = false;
        return hose.observe(encoded.success, { signal }).pipe(
          map((value) => decodeMessage(value)),
          tap({
            next: (message) => {
              if (message.type === "snapshot") {
                if (receivedSnapshot)
                  throw new Tea.Error({
                    code: "invalid_data",
                    message: "Unexpected Tea snapshot",
                  });
                receivedSnapshot = true;
              } else if (!receivedSnapshot || request.to !== "now") {
                throw new Tea.Error({
                  code: "invalid_data",
                  message: "Tea updates arrived outside a live observation",
                });
              }
            },
            complete: () => {
              if (!receivedSnapshot)
                throw new Tea.Error({
                  code: "invalid_data",
                  message: "Tea observation ended before its snapshot",
                });
            },
          }),
          catchError((error) => throwError(() => teaError(error, signal))),
        );
      }).pipe(catchError((error) => throwError(() => teaError(error)))),
    /** Release a compiled script independently of other users, including during shutdown.
     * Concurrent releases of the same ID share one request. Failures retain ownership for
     * shutdown retry.
     * @example await tea.dispose({id: compiled.id});
     */
    dispose,
    /** Stop admission/observations, await pending compiles and release every owned node.
     * Does not disconnect the shared transport. Repeated calls share shutdown; a failed
     * shutdown rejects and a later close retries remaining releases. The owner must await
     * this before retiring transport. @example await tea.close();
     */
    close: (): Promise<void> => {
      if (closing) return closing;
      lifetime.abort(
        new Tea.Error({ code: "cancelled", message: "Tea client closed" }),
      );
      closing = (async () => {
        await Promise.allSettled([...compiling]);
        const results = await Promise.allSettled(
          [...nodes].map((id) => dispose({ id })),
        );
        const failures = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (failures.length)
          throw new AggregateError(failures, "Could not dispose Tea nodes");
      })().catch((error) => {
        closing = undefined;
        throw error;
      });
      return closing;
    },
  };
}

/** Ordinary Promise/Observable Tea access, independent of React. */
export type TeaClient = ReturnType<typeof createTeaClient>;
