// Purpose: Connect TradingView through the user's normal browser and a bound login link.

import { createHash, randomBytes } from "node:crypto";
import { Effect, Predicate } from "effect";
import {
  fetchProfile,
  parseSession,
  userAgent,
} from "@openchart/server/data/providers/tradingview/credential";
import { Integration } from "./integration";

const integrationID = Integration.IntegrationID.make("tradingview");
const methodID = Integration.MethodID.make("browser");
const callbackURL = "tradingview://browser-auth/";
const authOrigin = "https://auth.tradingview.com";
const sessionCookies = new Set(["sessionid", "sessionid_sign", "device_t"]);

/**
 * Reads only TradingView's browser-auth callback, never an arbitrary URL or cookie.
 * Malformed, repeated, or missing tokens throw a sanitized error. The caller owns
 * the one-time link and must not log it or retain it after completion.
 * @example const token = tradingViewLoginToken(copiedLink);
 */
export function tradingViewLoginToken(link: string): string {
  const invalid = () =>
    new Error(
      "Paste the login link copied from TradingView's browser confirmation page.",
    );
  if (link.length > 8192) throw invalid();
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw invalid();
  }
  const tokens = url.searchParams.getAll("token");
  if (
    url.protocol !== "tradingview:" ||
    url.hostname !== "browser-auth" ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    tokens.length !== 1 ||
    url.searchParams.size !== 1 ||
    !tokens[0] ||
    /\s/.test(tokens[0]) ||
    tokens[0].length > 4096
  )
    throw invalid();
  return tokens[0];
}

/**
 * Builds TradingView's browser authorization method with injectable HTTP for tests.
 * Each attempt retains a private verifier in Integration's scope; only its SHA-256
 * challenge leaves in the browser URL. TradingView accepts its own callback scheme,
 * so the user copies the resulting login link instead of changing OS protocol
 * handlers. The backend exchanges the bound token and verifies the session before
 * Integration encrypts it. Cancellation aborts HTTP; failures never replace a
 * saved credential and become one generic error, so no token or verifier reaches
 * attempt state. No browser cookies or passwords are read from the renderer.
 * @example const method = tradingViewBrowserMethod();
 */
export function tradingViewBrowserMethod(
  fetcher: typeof fetch = fetch,
): Integration.OAuthImplementation {
  return {
    integrationID,
    method: { id: methodID, type: "oauth", label: "Sign in with your browser" },
    label: (credential) => {
      const username = credential.metadata?.username;
      return Predicate.isString(username) ? username : "TradingView";
    },
    authorize: () =>
      Effect.sync(() => {
        const verifier = randomBytes(24).toString("base64url");
        const challenge = createHash("sha256").update(verifier).digest("hex");
        const url = new URL("/accounts/tvd/connect/", authOrigin);
        url.search = new URLSearchParams({
          locale: "en",
          key: challenge,
          redirect_url: callbackURL,
        }).toString();
        return {
          url: url.href,
          mode: "code" as const,
          instructions:
            "At the bottom of TradingView’s page, click “copy the secret key” to copy your login link.",
          callback: Effect.fn("TradingView.authorize")(
            function* (link: string) {
              const token = yield* Effect.try(() =>
                tradingViewLoginToken(link),
              );
              const cookies = yield* Effect.tryPromise(async (signal) => {
                const completion = new URL(
                  "/accounts/tvd/complete/",
                  authOrigin,
                );
                // TradingView requires these parameters on a POST query, not in its
                // body. This URL stays backend-only and is never logged or followed.
                completion.search = new URLSearchParams({
                  token,
                  key_source: verifier,
                }).toString();
                const response = await fetcher(completion, {
                  method: "POST",
                  redirect: "error",
                  signal,
                  headers: {
                    referer: "https://www.tradingview.com/",
                    accept: "application/json",
                    "user-agent": userAgent,
                  },
                });
                await response.body?.cancel();
                return response.ok ? response.headers.getSetCookie() : [];
              }).pipe(Effect.timeout("30 seconds"));
              const signedIn = cookies.flatMap((cookie) => {
                const pair = cookie.split(";", 1)[0]!;
                const separator = pair.indexOf("=");
                const name = pair.slice(0, separator);
                return separator > 0 && sessionCookies.has(name)
                  ? [[name, pair.slice(separator + 1)]]
                  : [];
              });
              const session = yield* Effect.fromNullishOr(
                parseSession(JSON.stringify(Object.fromEntries(signedIn))),
              );
              const profile = yield* fetchProfile(
                fetcher,
                "https://www.tradingview.com/",
                session,
              );
              return {
                type: "oauth" as const,
                methodID,
                access: JSON.stringify(session),
                refresh: "",
                expires: 0,
                metadata: { username: profile.username },
              };
            },
            // The one sanitizing boundary: transport failures can quote the
            // token and verifier URL, so no upstream cause reaches attempt state.
            Effect.mapError(() => new Error("TradingView sign-in failed.")),
          ),
        };
      }),
  };
}

/** Browser session registration; Integration owns attempt cleanup and encrypted persistence. */
export const TRADINGVIEW = tradingViewBrowserMethod();
