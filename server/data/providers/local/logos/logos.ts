// Purpose: Publish the bundled logo Dataset; load metadata once and images on demand.
import { readFile } from "node:fs/promises";
import { Context, Effect, Layer, Schema, Stream } from "effect";
import { DatasetFailure, DatasetReasons } from "@openchart/server/data/dataset";
import { logos } from "./definition";
import { makeDataset, type IDatasetProvider } from "@openchart/server/data";
import { LogoCatalog, logoSearch } from "./catalog";
import { feeds } from "./feed";

const assets = new URL("./assets/", import.meta.url);
const invalidBundle = (cause: unknown) =>
  new DatasetFailure(new DatasetReasons.InvalidResult(), { cause });

/** Load and validate bundled metadata in the Provider scope. Accepted searches
 * keep their own I/O scope and return image data URLs, without external requests.
 * @example yield* makeLogosDataset();
 */
export const makeLogosDataset = Effect.fn("makeLogosDataset")(function* () {
  const catalog = yield* Effect.tryPromise({
    try: async (signal) =>
      Schema.decodeUnknownSync(Schema.fromJsonString(LogoCatalog))(
        await readFile(new URL("catalog.json", assets), {
          encoding: "utf8",
          signal,
        }),
      ),
    catch: invalidBundle,
  });
  const search = logoSearch(catalog);
  return yield* makeDataset(logos, {
    search: ({ query, limit }) =>
      Effect.forEach(search(query).slice(0, limit), (entry) =>
        Effect.tryPromise({
          try: async (signal) => {
            const bytes = await readFile(new URL(entry.asset, assets), {
              signal,
            });
            const type = entry.asset.endsWith(".svg")
              ? "svg+xml"
              : entry.asset.endsWith(".png")
                ? "png"
                : "jpeg";
            return {
              id: entry.id,
              url: `data:image/${type};base64,${bytes.toString("base64")}`,
            };
          },
          catch: invalidBundle,
        }),
      ),
  });
});

/** Always-available local logos; Catalog owns observation, never their files. */
export class LogosProvider extends Context.Service<
  LogosProvider,
  IDatasetProvider
>()("data/LogosProvider") {
  /** Source-owned Feed bindings; construction acquires no resources. */
  static readonly feeds = feeds;
  static readonly layer = Layer.succeed(LogosProvider, {
    definitions: [logos],
    watch: () =>
      Stream.unwrap(
        makeLogosDataset().pipe(
          Effect.map((dataset) =>
            Stream.concat(Stream.succeed([dataset]), Stream.never),
          ),
          Effect.orDie,
        ),
      ),
  });
}
