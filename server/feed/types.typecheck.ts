// Purpose: Known adapters reject incompatible datasets; Layers retain their Provider/Catalog/Events requirements.
import { Context, Effect, Layer } from "effect";
import {
  Catalog,
  catalogLayer,
  type IDatasetProvider,
} from "@openchart/server/data";
import type { Database } from "@openchart/server/db";
import type { Events } from "@openchart/server/events";
import { feedLayer } from "./layer";
import { Feed } from "./service";
class Provider extends Context.Service<Provider, IDatasetProvider>()(
  "test/feed/Provider",
) {}
function contracts() {
  const catalog: Layer.Layer<Catalog, never, Provider> = catalogLayer(
    Effect.all([Provider]),
  );
  const feeds: Layer.Layer<
    Feed,
    never,
    Provider | Events.Service | Database.Service
  > = feedLayer.pipe(Layer.provide(catalog));
  // @ts-expect-error Catalog and Events must be provided at composition
  const closed: Layer.Layer<Feed> = feedLayer;
  return { feeds, closed };
}
void contracts;
