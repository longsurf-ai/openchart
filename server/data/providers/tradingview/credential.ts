// Purpose: Read a stored TradingView cookie session and derive its user profile.

import { Effect, Schema } from "effect";
import type { DatasetFailure } from "@openchart/server/data/dataset";
import {
  expiredSession,
  invalidResult,
  statusFailure,
  tradingviewError,
} from "./errors";

/** TradingView's signed-in session and its optional signature/device binding. */
export interface Session {
  readonly sessionid: string;
  readonly sessionid_sign?: string;
  readonly device_t?: string;
}

/** One HTTP identity shared by session exchange, profile validation and chart I/O. */
export const userAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** The authenticated account facts needed for the socket and access checks. */
export interface Profile {
  readonly username: string;
  /** Raw TradingView plan slug, such as `pro_premium`; empty for a free account. */
  readonly plan: string;
  readonly isPro: boolean;
  readonly authToken: string;
  /** Historical bars TradingView admits per request for this plan. */
  readonly maxBars: number;
}

const planBars: Readonly<Record<string, number>> = {
  "": 5_000,
  pro: 10_000,
  pro_plus: 10_000,
  pro_premium: 20_000,
  ultimate: 40_000,
};

/** Anonymous and free sessions share TradingView's smallest history window. */
export const anonymousMaxBars = planBars[""]!;

const opaque = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((value) => !/[;\s]/.test(value), {
    message: "Cookie values cannot contain whitespace or semicolons",
  }),
);
const decodeSession = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      sessionid: opaque,
      sessionid_sign: Schema.optionalKey(opaque),
      device_t: Schema.optionalKey(opaque),
    }),
  ),
);

/**
 * Decodes the JSON cookie record written by browser authorization; other
 * fields are dropped. Anything else returns undefined so a malformed record is
 * never mistaken for anonymous use.
 * @example
 * parseSession('{"sessionid":"abc","sessionid_sign":"def"}'); // {sessionid: 'abc', sessionid_sign: 'def'}
 */
export function parseSession(value: string): Session | undefined {
  const decoded = decodeSession(value);
  return decoded._tag === "Some" ? decoded.value : undefined;
}

/** Renders the signed-in cookies for an outbound request; never log this value. */
export function cookieHeader(session: Session) {
  return `sessionid=${session.sessionid}${
    session.sessionid_sign === undefined
      ? ""
      : `; sessionid_sign=${session.sessionid_sign}`
  }${session.device_t === undefined ? "" : `; device_t=${session.device_t}`}`;
}

const ProfileBootstrap = Schema.Struct({
  username: Schema.NonEmptyString,
  auth_token: Schema.NonEmptyString,
  pro_plan: Schema.optionalKey(Schema.String),
  is_pro: Schema.optionalKey(Schema.Boolean),
});
const decodeProfile = Schema.decodeUnknownOption(
  Schema.fromJsonString(ProfileBootstrap),
);

/** Extracts the signed-in user's JSON bootstrap from TradingView's homepage HTML.
 * Decodes the complete assignment without executing scripts. Account settings
 * can separate identity and token fields by tens of thousands of characters;
 * unrelated objects and nested settings never supply account facts.
 * @example const profile = parseProfileHtml(html);
 */
export function parseProfileHtml(
  html: string,
): Omit<Profile, "maxBars"> | undefined {
  const match = /\bvar\s+user\s*=\s*(\{[^\r\n]*\})\s*;/.exec(html);
  if (!match) return undefined;
  const decoded = decodeProfile(match[1]);
  if (decoded._tag === "None") return undefined;
  const user = decoded.value;
  const plan = user.pro_plan ?? "";
  return {
    username: user.username,
    plan,
    isPro: user.is_pro === true || plan.length > 0,
    authToken: user.auth_token,
  };
}

/** Reads the authenticated homepage with the stored cookies. Up to three
 * redirects may remain on the initial origin or select an HTTPS TradingView
 * language homepage; no credential is forwarded to another site. A missing auth
 * token means TradingView rejected the session and the user must reconnect.
 * @example const profile = yield* fetchProfile(fetcher, homeUrl, session);
 */
export const fetchProfile = Effect.fn("TradingView.fetchProfile")(function* (
  fetcher: typeof fetch,
  homeUrl: string,
  session: Session,
): Effect.fn.Return<Profile, DatasetFailure> {
  const html = yield* Effect.tryPromise({
    try: async (signal) => {
      const initial = new URL(homeUrl);
      let url = initial;
      const localeHost = (hostname: string) =>
        hostname === "tradingview.com" ||
        /^(?:www|[a-z]{2}(?:-[a-z]{2})?)\.tradingview\.com$/.test(hostname);
      const headers = {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        cookie: cookieHeader(session),
        referer: "https://www.tradingview.com/",
        "user-agent": userAgent,
      };
      for (let redirects = 0; ; redirects++) {
        const response = await fetcher(url, {
          signal,
          redirect: "manual",
          headers,
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) {
          if (!response.ok) {
            await response.body?.cancel();
            throw statusFailure(response.status, "TradingView");
          }
          return response.text();
        }
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects >= 3)
          throw invalidResult("TradingView profile redirects did not resolve.");
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw invalidResult(
            "TradingView returned an invalid profile redirect.",
          );
        }
        const languageHomepage =
          initial.protocol === "https:" &&
          localeHost(initial.hostname) &&
          next.protocol === "https:" &&
          !next.port &&
          localeHost(next.hostname) &&
          next.pathname === initial.pathname;
        if (
          next.username ||
          next.password ||
          (next.origin !== initial.origin && !languageHomepage)
        )
          throw invalidResult(
            "TradingView redirected the profile outside its allowed origins.",
          );
        url = next;
      }
    },
    catch: tradingviewError,
  }).pipe(
    Effect.timeoutOrElse({
      duration: "20 seconds",
      orElse: () =>
        Effect.fail(
          tradingviewError("TradingView did not answer within 20 seconds."),
        ),
    }),
  );
  const parsed = parseProfileHtml(html);
  if (!parsed)
    return yield* expiredSession(
      "TradingView did not recognize the stored session cookies.",
    );
  return {
    ...parsed,
    maxBars: planBars[parsed.plan.toLowerCase()] ?? anonymousMaxBars,
  };
});
