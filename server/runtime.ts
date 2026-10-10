// Purpose: Owns the server-lifetime Effect Layer and ManagedRuntime.

import path from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Home } from "./home";
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect";
import * as ResourceEvents from "@openchart/server/lib/resource/events";
import { AgentProfile } from "@openchart/server/agent/profiles/profile";
import { PluginRegistry } from "@openchart/server/agent/plugin/registry";
import { Plugin } from "@openchart/server/agent/plugin";
import { chartExplainPlugin } from "@openchart/server/agent/plugin/plugins/chart-explain";
import { Permission } from "@openchart/server/agent/permission";
import { Question } from "@openchart/server/agent/question";
import { Session } from "@openchart/server/agent/session";
import { ToolRegistry } from "@openchart/server/agent/tool/registry";
import { LLM } from "@openchart/server/agent/llm";
import { Models } from "@openchart/server/models";
import { Scheduler } from "@openchart/server/scheduler";
import { Collection } from "@openchart/server/collection";
import { Alert } from "@openchart/server/alert";
import { Bus } from "@openchart/server/bus";
import { Notification } from "@openchart/server/notification";
import { Monitoring } from "@openchart/server/monitoring";
import { Trigger } from "@openchart/server/trigger";
import {
  layer as authLayer,
  type Configuration as AuthConfiguration,
} from "@openchart/server/access/auth/layer";
import { Credential } from "@openchart/server/access/credential";
import {
  layer as billingLayer,
  type Configuration as BillingConfiguration,
} from "@openchart/server/access/billing/layer";
import {
  OpenChartClient,
  layer as openchartClientLayer,
} from "@openchart/server/data/providers/openchart/client";

import { Catalog, catalogLayer } from "@openchart/server/data";
import {
  dataProviders,
  dataProviderLayer,
} from "@openchart/server/data/providers";
import {
  layerFromFile,
  layerFromProvider,
} from "@openchart/server/config/provider";
import { WorkspacesLayer } from "@openchart/server/workspace/workspace";
import { ensureBuiltinIndicators } from "@openchart/server/indicators/indicators";
import { ensureDefaultWorkflows } from "@openchart/server/agent/workflow/defaults";
import { feedLayer } from "@openchart/server/feed/layer";
import * as Tea from "@openchart/server/tea/tea";
import { agentLayer } from "./agent";
import { layer as alertBackgroundLayer } from "./alert/background";
import { layer as monitoringBackgroundLayer } from "./monitoring/background";
import { layer as schedulerBackgroundLayer } from "./scheduler/background";
import { layer as triggerBackgroundLayer } from "./trigger/background";
import * as Agui from "./agent/publisher/agui/adapter";
import { Database } from "./db/database";
import * as Events from "./events/events";
import { layer as integrationLayer } from "@openchart/server/access/integration/layer";
import type { Integration } from "@openchart/server/access/integration";

/** Options that select process-owned resources for one server runtime. */
export interface RuntimeOptions {
  /** Host-selected profile directory for SQLite, settings, cache and workspaces. */
  readonly home: string;
  /** Tests may replace only SQLite with an in-memory database. */
  readonly databasePath?: ":memory:";
  /** Host-owned encryption; without it, credential secret reads/writes fail. */
  readonly credentialEncryption?: Credential.Encryption;
  /** Host-owned system notifications; without it, notifications are only logged. */
  readonly notify?: Notification.Notify;
  /** Ready Dataset catalog supplied by embedding/tests; otherwise watch public Providers. */
  readonly datasets?: Layer.Layer<Catalog, unknown>;
  /** Native config source; otherwise watch settings.json under home. */
  readonly config?: ConfigProvider.ConfigProvider;
  /** Catalog and managed-runtime startup overrides; provider discovery remains lazy. */
  readonly models?: Partial<
    Omit<Models.Options, "cacheDirectory" | "runtimeDirectory">
  >;
  /** Profile configuration shared by prompt execution and permission evaluation. */
  readonly profiles?: AgentProfile.Configuration;
  /** Integration identities and authentication methods registered at startup. */
  readonly integrations?: Integration.Configuration;
  /** Account integration identity; omitted hosts expose unavailable Auth. */
  readonly auth?: Omit<AuthConfiguration, "resetConnections">;
  /** Independent billing API endpoint; omitted hosts expose unavailable Billing. */
  readonly billing?: BillingConfiguration;
  /** Host-selected default Cloud data endpoint, paired with its account environment. */
  readonly openchartUrl?: string;
}

function makeDatabaseLayer(root: string, options: RuntimeOptions) {
  const filename = options.databasePath ?? path.join(root, "openchart.sqlite3");
  return Layer.unwrap(
    Effect.map(Events.Service, (events) =>
      Database.layer(filename, ResourceEvents.makeOnCommitted(events)),
    ),
  ).pipe(Layer.provideMerge(Events.layer));
}

function makeAccessLayer(options: RuntimeOptions) {
  return Layer.unwrap(
    Effect.map(OpenChartClient, (openchart) =>
      authLayer(
        options.auth && {
          ...options.auth,
          resetConnections: () => openchart.reset(),
        },
      ),
    ),
  ).pipe(
    Layer.provideMerge(
      Layer.merge(
        openchartClientLayer(options.openchartUrl),
        billingLayer(options.billing),
      ),
    ),
    Layer.provideMerge(
      integrationLayer(options.integrations).pipe(
        Layer.provideMerge(Credential.layer(options.credentialEncryption)),
      ),
    ),
  );
}

function makeAgentLayer(
  root: string,
  options: RuntimeOptions,
  database: ReturnType<typeof makeDatabaseLayer>,
) {
  const models = Models.layer({
    cacheDirectory: path.join(root, ".cache", "models"),
    runtimeDirectory: path.join(root, "model-providers"),
    fetchEnabled: true,
    userAgent: "OpenChart/V2",
    ...options.models,
  });
  const services = Layer.mergeAll(
    Permission.layer,
    Question.layer,
    ToolRegistry.layer,
    Layer.unwrap(
      Effect.map(Plugin.bind(chartExplainPlugin), (plugin) =>
        PluginRegistry.layer([plugin]),
      ),
    ),
    LLM.layer.pipe(Layer.provideMerge(models)),
  ).pipe(
    Layer.provideMerge(Tea.layer),
    Layer.provideMerge(
      Layer.effectDiscard(
        ensureBuiltinIndicators().pipe(
          Effect.andThen(ensureDefaultWorkflows()),
        ),
      ).pipe(Layer.provideMerge(WorkspacesLayer), Layer.provideMerge(database)),
    ),
    Layer.provideMerge(
      Layer.merge(
        Agui.layer.pipe(
          Layer.provideMerge(Layer.merge(database, Session.layer)),
        ),
        AgentProfile.layer(options.profiles ?? {}),
      ),
    ),
  );
  return agentLayer.pipe(Layer.provideMerge(services));
}

function makeFeedLayer(
  options: RuntimeOptions,
  database: ReturnType<typeof makeDatabaseLayer>,
) {
  const datasets = options.datasets ?? catalogLayer(dataProviders);
  return feedLayer.pipe(
    Layer.provideMerge(datasets),
    Layer.provideMerge(dataProviderLayer),
    // Workspace Datasets read their files through the shared Workspaces instance.
    Layer.provideMerge(WorkspacesLayer),
    Layer.provideMerge(database),
  );
}

function makeConfigLayer(root: string, options: RuntimeOptions) {
  return options.config
    ? layerFromProvider(options.config)
    : layerFromFile(path.join(root, "settings.json")).pipe(
        Layer.provide(Events.layer),
      );
}

function makeApplicationLayer(options: RuntimeOptions) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const { root } = yield* Home;
      const database = makeDatabaseLayer(root, options);
      const application = Layer.mergeAll(
        Scheduler.layer,
        Alert.layer,
        Trigger.layer,
        Bus.layer,
        Notification.layer(options.notify),
        Monitoring.layer,
        makeAgentLayer(root, options, database),
      ).pipe(
        Layer.provideMerge(makeFeedLayer(options, database)),
        Layer.provideMerge(
          makeAccessLayer(options).pipe(Layer.provideMerge(database)),
        ),
        Layer.provideMerge(Events.layer),
        Layer.provideMerge(makeConfigLayer(root, options)),
      );
      // Background fibers sit above every dependency, so shutdown interrupts and
      // joins them first. Agent checks and Alert observations share Tea below.
      // Collection reads Agent admission, Workspaces and Monitoring, so it sits
      // between them and the application; script runs end before those close.
      return Layer.mergeAll(
        schedulerBackgroundLayer,
        triggerBackgroundLayer,
        alertBackgroundLayer,
        monitoringBackgroundLayer,
      ).pipe(
        Layer.provideMerge(Collection.layer),
        Layer.provideMerge(application),
      );
    }),
  ).pipe(
    Layer.provideMerge(
      Home.layer(options.home).pipe(Layer.provideMerge(NodeFileSystem.layer)),
    ),
  );
}

/**
 * Creates the shared Effect runtime used by one V2 server instance.
 *
 * The runtime builds its services and background fibers lazily and shares them
 * across requests. Hosts await runtime.context() before accepting traffic so
 * background work starts without a request. Disposal interrupts and awaits the
 * background fibers before releasing their service dependencies.
 *
 * @param options - Process-owned resource configuration.
 * @returns A managed runtime containing every server application service.
 *
 * @example
 * ```ts
 * const runtime = makeRuntime({home: '/tmp/openchart-test', databasePath: ':memory:'});
 * try {
 *   await runtime.context();
 * } finally {
 *   await runtime.dispose();
 * }
 * ```
 */
export function makeRuntime(options: RuntimeOptions) {
  return ManagedRuntime.make(makeApplicationLayer(options));
}

/** The managed Effect runtime owned by one V2 server instance. */
export type Runtime = ReturnType<typeof makeRuntime>;

/** Return a message through the shared runtime. @example yield* echo('hello'); */
export function echo(message: string) {
  return Effect.succeed({ message });
}
