// Purpose: Publish one runtime Dataset per Workspace Dataset Resource, following Resource changes.
import {
  Context,
  Effect,
  Exit,
  Layer,
  Schedule,
  Schema,
  Scope,
  Stream,
} from "effect";
import {
  makeDataset,
  type Dataset,
  type IDatasetProvider,
} from "@openchart/server/data";
import { unregister } from "@openchart/server/data/dataset";
import { Database } from "@openchart/server/db/database";
import { Events } from "@openchart/server/events";
import { Transactor } from "@openchart/server/lib/resource";
import { ResourceChanged } from "@openchart/server/lib/resource/events";
import { workspaceDatasetResource } from "@openchart/server/resources/workspace-dataset";
import type {
  WorkspaceDatasetEntity,
  WorkspaceDatasetId,
} from "@openchart/server/resources/workspace-dataset/entity";
import { Workspaces } from "@openchart/server/workspace/workspace";
import {
  declarationKey,
  declareWorkspaceDataset,
  selectWorkspaceDataset,
} from "./datasets";
import { feeds } from "./feed";

interface Published {
  readonly key: string;
  readonly scope: Scope.Closeable;
  readonly dataset: Dataset;
}

/**
 * Workspace Datasets as runtime timeseries Datasets. Resource CRUD drives
 * their lifecycle: creating declares and publishes one; changing its source,
 * time or columns retires the instance (new calls fail `Dataset.Retired`),
 * releases its name and publishes a replacement; deleting withdraws it.
 * Editing the CSV file changes no instance, since each select reads the file.
 * Catalog observes it once; the observer resubscribes after event overflow.
 */
export class WorkspaceDatasetsProvider extends Context.Service<
  WorkspaceDatasetsProvider,
  IDatasetProvider
>()("data/WorkspaceDatasetsProvider") {
  /** Source-owned Feed bindings; construction acquires no resources. */
  static readonly feeds = feeds;
  static readonly layer = Layer.effect(
    WorkspaceDatasetsProvider,
    Effect.gen(function* () {
      const context = yield* Effect.context<
        Database.Service | Events.Service | Workspaces
      >();
      const workspaces = yield* Workspaces;
      const published = new Map<WorkspaceDatasetId, Published>();

      const retire = Effect.fnUntraced(function* (id: WorkspaceDatasetId) {
        const entry = published.get(id)!;
        published.delete(id);
        yield* Scope.close(entry.scope, Exit.void);
        unregister(entry.dataset.definition);
      });
      const publish = Effect.fnUntraced(function* (
        entity: WorkspaceDatasetEntity,
      ) {
        const definition = declareWorkspaceDataset(entity);
        const scope = yield* Scope.make();
        const dataset = yield* makeDataset(definition, {
          select: (query) =>
            selectWorkspaceDataset(
              workspaces,
              entity,
              definition,
              query as Parameters<typeof selectWorkspaceDataset>[3],
            ),
        }).pipe(Scope.provide(scope));
        published.set(entity.id, {
          key: declarationKey(entity),
          scope,
          dataset,
        });
      });
      // Retire before publishing replacements; unchanged instances keep their identity.
      const reconcile = Effect.fnUntraced(function* () {
        const entities = yield* Transactor.run(
          workspaceDatasetResource.transitions.listAll(),
        );
        const current = new Map(entities.map((entity) => [entity.id, entity]));
        for (const [id, entry] of [...published]) {
          const entity = current.get(id);
          if (!entity || declarationKey(entity) !== entry.key)
            yield* retire(id);
        }
        for (const entity of entities)
          if (!published.has(entity.id)) yield* publish(entity);
        return [...published.values()].map(({ dataset }) => dataset);
      });
      // Subscribe before the first read, so no change falls between the two.
      const observe = Stream.unwrap(
        Effect.map(Events.allBounded(256), (changes) =>
          Stream.concat(
            Stream.succeed(undefined),
            changes.pipe(
              Stream.filter(Schema.is(ResourceChanged)),
              Stream.filter(
                (event) =>
                  event.data.resource === workspaceDatasetResource.name,
              ),
            ),
          ),
        ),
      ).pipe(
        Stream.mapEffect(() => reconcile()),
        Stream.tapError((error) =>
          Effect.logWarning("Workspace Dataset observation restarts", error),
        ),
        Stream.retry(Schedule.spaced("1 second")),
        // Retrying forever leaves only defects, which Catalog reports.
        Stream.orDie,
      );

      return WorkspaceDatasetsProvider.of({
        get definitions() {
          return [...published.values()].map(
            ({ dataset }) => dataset.definition,
          );
        },
        watch: () =>
          Stream.unwrap(
            Effect.addFinalizer(() =>
              Effect.forEach([...published.keys()], retire, { discard: true }),
            ).pipe(Effect.as(observe)),
          ).pipe(Stream.provideContext(context)),
      });
    }),
  );
}
