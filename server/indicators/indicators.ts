// Purpose: Install bundled, read-only originals in the default Workspace.
import { readFile } from "node:fs/promises";
import { Effect, Schema } from "effect";
import * as Tea from "@openchart/tea";
import { Workspaces } from "@openchart/server/workspace/workspace";
import type { Workspace } from "@openchart/server/workspace/instance";
import { RelPath } from "@openchart/server/workspace/contract";
import { workspaceResource } from "@openchart/server/resources/workspace";
import { Transactor } from "@openchart/server/lib/resource";
import { chartBuiltins, indicatorCatalog } from "./catalog";

const indicatorPath = (entry: { readonly path: string }) =>
  Schema.decodeUnknownSync(RelPath)(entry.path);

const readTemplate = (id: string) =>
  Effect.tryPromise({
    try: () =>
      readFile(new URL(`./builtins/${id}.tea`, import.meta.url), "utf8"),
    catch: (cause) =>
      new Tea.Error(
        {
          code: "compile_failed",
          message: "Indicator template could not be read",
        },
        { cause },
      ),
  });

const createTemplate = (workspace: Workspace, path: RelPath, source: string) =>
  workspace.installBuiltin(path, source).pipe(Effect.asVoid);

/** Install one explicitly selected starter when its original is missing. @example yield* installIndicator("sma"); */
export const installIndicator = Effect.fn("Indicators.install")(function* (
  id: string,
) {
  const entry = indicatorCatalog.find((entry) => entry.id === id);
  if (!entry)
    return yield* Effect.fail(
      new Tea.Error({
        code: "invalid_request",
        message: "Unknown indicator template",
      }),
    );
  const workspaceId = yield* Transactor.run(
    workspaceResource.transitions.getDefault(),
  );
  const workspace = yield* (yield* Workspaces).open(workspaceId);
  const path = indicatorPath(entry);
  const exists = yield* workspace.read(path).pipe(
    Effect.as(true),
    Effect.catchTag("EntryMissing", () => Effect.succeed(false)),
  );
  if (!exists) yield* createTemplate(workspace, path, yield* readTemplate(id));
  return { workspaceId, path };
});

/**
 * Where a chart built-in lives: its original in the default Workspace, which
 * startup installs. It never installs or reads the file itself.
 * @example const source = yield* chartBuiltinSource("volume-profile-range");
 */
export const chartBuiltinSource = Effect.fn("Indicators.chartBuiltinSource")(
  function* (id: (typeof chartBuiltins)[number]["id"]) {
    const workspaceId = yield* Transactor.run(
      workspaceResource.transitions.getDefault(),
    );
    return {
      workspaceId,
      path: indicatorPath(chartBuiltins.find((entry) => entry.id === id)!),
    };
  },
);

/**
 * Make every built-in original match its bundled text before startup
 * completes, including in existing profiles: a missing file is restored, and
 * one from an older version or changed outside the app is rewritten. The app
 * never lets users edit originals; they edit copies. Failed installation can
 * safely retry on the next start.
 * @example yield* ensureBuiltinIndicators();
 */
export const ensureBuiltinIndicators = Effect.fn("Indicators.ensureBuiltins")(
  function* () {
    const workspaceId = yield* Transactor.run(
      workspaceResource.transitions.getDefault(),
    );
    const workspace = yield* (yield* Workspaces).open(workspaceId);
    const templates = yield* Effect.forEach(
      [...indicatorCatalog, ...chartBuiltins],
      (entry) =>
        Effect.map(readTemplate(entry.id), (source) => ({
          path: indicatorPath(entry),
          source,
        })),
      { concurrency: "unbounded" },
    );
    // Load sources first, then queue every write so Workspace can coalesce scans.
    yield* Effect.forEach(
      templates,
      ({ path, source }) => createTemplate(workspace, path, source),
      {
        concurrency: "unbounded",
        discard: true,
      },
    );
  },
);
