// Purpose: Resolve the stored TradingView browser session without falling back to anonymous use.

import { Effect } from "effect";
import { Integration } from "@openchart/server/access/integration";
import { TRADINGVIEW } from "@openchart/server/access/integration/tradingview";
import { DatasetFailure, DatasetReasons } from "@openchart/server/data/dataset";
import { parseSession, type Session } from "./credential";

/** Resolves the active TradingView browser session.
 * Undefined means anonymous use; malformed or other-method credentials deny
 * access instead of silently falling back to anonymous data.
 * @example const credential = yield* makeCredential;
 */
export const makeCredential = Effect.gen(function* () {
  const integrations = yield* Integration.Service;
  return Effect.fn("TradingView.credential")(function* (): Effect.fn.Return<
    Session | undefined,
    DatasetFailure
  > {
    const value = yield* integrations.connection
      .resolveCredential(TRADINGVIEW.integrationID)
      .pipe(
        Effect.mapError(
          (cause) =>
            new DatasetFailure(new DatasetReasons.Unavailable(), { cause }),
        ),
      );
    if (value === undefined) return undefined;
    if (value.type !== "oauth" || value.methodID !== TRADINGVIEW.method.id)
      return yield* Effect.fail(
        new DatasetFailure(new DatasetReasons.AccessDenied(), {
          cause: "TradingView requires a browser sign-in session.",
        }),
      );
    const session = parseSession(value.access);
    if (session === undefined)
      return yield* Effect.fail(
        new DatasetFailure(new DatasetReasons.AccessDenied(), {
          cause: "Stored TradingView session cookies are malformed.",
        }),
      );
    return session;
  });
});
