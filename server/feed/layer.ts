// Purpose: Keep the latest successfully provisioned Feed snapshot without owning Dataset lifetimes.
import { randomUUID } from "node:crypto";
import { Effect, Layer, Ref, Schema, Stream } from "effect";
import { FeedVersion } from "@openchart/feed";
import { Catalog, type Dataset } from "@openchart/server/data";
import { Events } from "@openchart/server/events";
import { providerFeeds } from "@openchart/server/data/providers";
import { logosFeed } from "@openchart/server/feed/logo/logo";
import { calendarFeed } from "@openchart/server/feed/calendar/calendar";
import { provisionBars } from "@openchart/server/feed/bar/provisioner";
import { provisionSymbology } from "@openchart/server/feed/symbology/provisioner";
import { Feed } from "./service";
import { FeedVersionChanged } from "./events";
import { SymbologyIndex } from "@openchart/server/feed/symbology/symbology";

/** Only declarations with a registered Feed binding can change the Feed version. */
const boundDefinitions = new Set(
  providerFeeds.flatMap(({ bars, symbology, logos, calendar }) =>
    [bars, symbology, logos, calendar].flatMap((adapter) =>
      adapter ? [adapter.definition] : [],
    ),
  ),
);

const makeSnapshot = Effect.fn("Feed.makeSnapshot")(function* (
  datasets: readonly Dataset[],
) {
  const bars = yield* provisionBars(datasets);
  const symbology = yield* provisionSymbology(datasets);
  return {
    version: Schema.decodeUnknownSync(FeedVersion)(randomUUID()),
    datasets,
    services: {
      bars,
      symbology,
      logos: logosFeed(datasets),
      calendar: calendarFeed(datasets),
    },
  };
});

/** Observe Catalog in the Layer scope; a provisioning defect retains the last successful snapshot.
 * Provider and request scopes own I/O. Replacing the snapshot never revokes returned services.
 * @example feedLayer.pipe(Layer.provide(catalogLayer(providers)));
 */
export const feedLayer = Layer.effect(
  Feed,
  Effect.gen(function* () {
    const catalog = yield* Catalog;
    const events = yield* Events.Service;
    const current = yield* Ref.make(yield* makeSnapshot([]));
    const update = Effect.fn("Feed.update")(
      function* (datasets: readonly Dataset[]) {
        const previous = yield* Ref.get(current);
        if (
          datasets.length === previous.datasets.length &&
          datasets.every((dataset) => previous.datasets.includes(dataset))
        )
          return;
        const next = yield* makeSnapshot(datasets);
        // @agent invariant: publish only after version and complete services commit together.
        yield* Ref.set(current, next);
        yield* events.publish(FeedVersionChanged, { version: next.version });
      },
      // Provisioning fails only by wiring defects; keep the last snapshot and
      // the observation so the next Catalog update can recover.
      Effect.catchDefect((defect) =>
        Effect.logError("Feed provisioning failed", defect),
      ),
    );
    yield* catalog.watch().pipe(
      Stream.map((datasets) =>
        datasets.filter((dataset) => boundDefinitions.has(dataset.definition)),
      ),
      Stream.runForEach(update),
      Effect.catchCause((cause) =>
        Effect.logError("Feed Catalog observation stopped", cause),
      ),
      Effect.forkScoped,
    );
    return Feed.of({
      getVersion: () =>
        Ref.get(current).pipe(Effect.map((value) => value.version)),
      get: () => Ref.get(current).pipe(Effect.map((value) => value.services)),
    });
  }),
).pipe(Layer.provide(SymbologyIndex.layer));
