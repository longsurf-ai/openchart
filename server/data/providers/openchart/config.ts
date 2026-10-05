// Purpose: Declare OpenChart's data setting and native connection config.
import { Config, Duration, Schema } from "effect";
import { providerEnabled } from "@openchart/server/data/providers/configured";

/** OpenChart data is enabled by default; availability also requires successful OpenChart admission. */
export const config = providerEnabled("openchart");

const BaseUrl = Schema.URLFromString.check(
  Schema.makeFilter(
    (url) =>
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))),
    {
      message:
        "OpenChart URL must use HTTPS or HTTP loopback, without credentials, query, or fragment",
    },
  ),
);

const Timeout = Schema.DurationFromString.check(
  Schema.makeFilter(
    (duration) =>
      Duration.isFinite(duration) && Duration.toMillis(duration) > 0,
    { message: "OpenChart request timeout must be positive and finite" },
  ),
);

/**
 * Reads the openchart namespace from the application's configured source.
 * The host supplies the default endpoint; other hosts default to production.
 * Settings can explicitly override it, using the same URL validation.
 * No network connection is created while resolving this config.
 * @example
 * import {connectionConfig as openchartConfig} from '@openchart/server/data/providers/openchart/config';
 * const config = yield* openchartConfig();
 * const endpoint = new URL('/marketfeed/live', config.baseUrl);
 */
export const connectionConfig = (baseUrl = "https://api.alpha.longsurf.ai") =>
  Config.all({
    baseUrl: Config.schema(BaseUrl, "baseUrl").pipe(
      Config.withDefault(new URL(baseUrl)),
    ),
    requestTimeout: Config.schema(Timeout, "requestTimeout").pipe(
      Config.withDefault(Duration.seconds(30)),
    ),
  }).pipe(Config.nested("openchart"));
