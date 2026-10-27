import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import {
  cookieHeader,
  fetchProfile,
  parseProfileHtml,
  parseSession,
} from "./credential";

const homepage = `<!doctype html><script>var user = {"id":1,"username":"alice","auth_token":"tok_123","pro_plan":"pro_premium","is_pro":true,"badges":[]};</script>`;

describe("stored TradingView sessions", () => {
  test("preserves the device binding returned by browser authorization", () => {
    const session = {
      sessionid: "session",
      sessionid_sign: "signature",
      device_t: "device",
    };
    expect(parseSession(JSON.stringify({ ...session, extra: "x" }))).toEqual(
      session,
    );
    expect(cookieHeader(session)).toBe(
      "sessionid=session; sessionid_sign=signature; device_t=device",
    );
    expect(
      parseSession(JSON.stringify({ ...session, device_t: "bad\nvalue" })),
    ).toBeUndefined();
  });

  test.each([
    "",
    "abc",
    "sessionid=abc; sessionid_sign=def",
    '{"sessionid":""}',
    '{"sessionid":"a;b"}',
    '{"sessionid_sign":"def"}',
  ])("only the stored JSON record names a session: %j", (value) => {
    expect(parseSession(value)).toBeUndefined();
  });

  test("renders the cookie header in TradingView's order", () => {
    expect(cookieHeader({ sessionid: "abc", sessionid_sign: "def" })).toBe(
      "sessionid=abc; sessionid_sign=def",
    );
  });
});

describe("TradingView homepage profile", () => {
  test("a signed-in language preference follows only the TradingView language homepage", async () => {
    const requests: { url: string; headers: Headers }[] = [];
    const profile = await Effect.runPromise(
      fetchProfile(
        async (input, init) => {
          requests.push({
            url: String(input),
            headers: new Headers(init?.headers),
          });
          return requests.length === 1
            ? new Response(null, {
                status: 302,
                headers: { location: "https://cn.tradingview.com/" },
              })
            : new Response(homepage);
        },
        "https://www.tradingview.com/",
        { sessionid: "signed-in", device_t: "device" },
      ),
    );
    expect(profile.username).toBe("alice");
    expect(requests.map(({ url }) => url)).toEqual([
      "https://www.tradingview.com/",
      "https://cn.tradingview.com/",
    ]);
    expect(requests[1]!.headers.get("cookie")).toBe(
      "sessionid=signed-in; device_t=device",
    );
  });

  test.each([
    "https://example.com/",
    "https://cn.tradingview.com.example.com/",
    "http://cn.tradingview.com/",
    "https://attacker@www.tradingview.com/",
    "https://cn.tradingview.com:8443/",
    "https://cn.tradingview.com/another-path",
  ])(
    "profile redirect %s never receives the session cookies",
    async (location) => {
      let requests = 0;
      const failure = await Effect.runPromise(
        Effect.flip(
          fetchProfile(
            async () => {
              requests++;
              return new Response(null, { status: 302, headers: { location } });
            },
            "https://www.tradingview.com/",
            { sessionid: "private" },
          ),
        ),
      );
      expect(failure.reason._tag).toBe("Dataset.InvalidResult");
      expect(requests).toBe(1);
    },
  );

  test("profile redirect loops are bounded", async () => {
    let requests = 0;
    const failure = await Effect.runPromise(
      Effect.flip(
        fetchProfile(
          async () => {
            requests++;
            return new Response(null, {
              status: 302,
              headers: { location: "https://cn.tradingview.com/" },
            });
          },
          "https://www.tradingview.com/",
          { sessionid: "private" },
        ),
      ),
    );
    expect(failure.reason._tag).toBe("Dataset.InvalidResult");
    expect(requests).toBe(4);
  });

  test("reads the signed-in user's token, name and plan from the bootstrap", () => {
    expect(parseProfileHtml(homepage)).toEqual({
      username: "alice",
      plan: "pro_premium",
      isPro: true,
      authToken: "tok_123",
    });
  });

  test("an anonymous homepage has no profile", () => {
    expect(
      parseProfileHtml('<script>var user = {"username":"Guest"};</script>'),
    ).toBeUndefined();
  });

  test("large account settings cannot hide or replace the profile fields", () => {
    const user = {
      username: 'alice "quoted"',
      settings: {
        username: "another-user",
        auth_token: "unrelated-token",
        pro_plan: "ultimate",
        padding: "x".repeat(65_000),
      },
      auth_token: "actual-token",
      pro_plan: "pro_premium",
      is_pro: true,
    };
    expect(
      parseProfileHtml(
        "<script>var user = " + JSON.stringify(user) + ";</script>",
      ),
    ).toEqual({
      username: 'alice "quoted"',
      authToken: "actual-token",
      plan: "pro_premium",
      isPro: true,
    });
  });

  test("unrelated tokens and incomplete user objects never establish a session", () => {
    expect(
      parseProfileHtml(
        '<script>var config = {"auth_token":"other"};\nvar user = {"username":"Guest"};</script>',
      ),
    ).toBeUndefined();
    expect(
      parseProfileHtml('<script>var user = {"auth_token":"token"};</script>'),
    ).toBeUndefined();
  });

  test("fetches the profile with the session cookie", async () => {
    const requests: RequestInit[] = [];
    const profile = await Effect.runPromise(
      fetchProfile(
        async (_input, init) => {
          requests.push(init ?? {});
          return new Response(homepage);
        },
        "https://www.tradingview.com/",
        { sessionid: "abc", sessionid_sign: "def" },
      ),
    );
    expect(profile).toMatchObject({
      username: "alice",
      plan: "pro_premium",
      authToken: "tok_123",
      maxBars: 20_000,
    });
    expect(new Headers(requests[0]!.headers).get("cookie")).toBe(
      "sessionid=abc; sessionid_sign=def",
    );
  });

  test("an expired session is an access denial, never anonymous use", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(
        fetchProfile(
          async () =>
            new Response('<script>var user = {"username":"Guest"};</script>'),
          "https://www.tradingview.com/",
          { sessionid: "expired" },
        ),
      ),
    );
    expect(failure.reason._tag).toBe("Dataset.AccessDenied");
  });

  test("a rejected HTTP status preserves its reason", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(
        fetchProfile(
          async () => new Response("", { status: 429 }),
          "https://www.tradingview.com/",
          { sessionid: "abc" },
        ),
      ),
    );
    expect(failure.reason._tag).toBe("Dataset.RateLimited");
  });
});
