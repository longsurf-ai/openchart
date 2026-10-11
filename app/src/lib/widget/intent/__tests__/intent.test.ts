// Purpose: Prove intent routing: resolution policy, delivery per handler lane, failures and handler lifetime.
import {
  createIntentRouter,
  defineIntent,
  mostRecentlyActive,
  type IntentHandler,
} from "../intent";

const show = defineIntent<{ symbol: string }>("Show", { delivery: "latest" });
const log = defineIntent<{ line: number }>("Log", { delivery: "each" });

/** A handler whose calls stay pending until the test settles them in order. */
function controlled<Payload>() {
  const calls: { payload: Payload; finish: () => void; fail: () => void }[] =
    [];
  const handle: IntentHandler<Payload> = (payload) =>
    new Promise<void>((resolve, reject) => {
      calls.push({
        payload,
        finish: resolve,
        fail: () => reject(new Error("offline")),
      });
    });
  return { calls, handle: vi.fn(handle) };
}

test("a raise without an answering placement settles as unavailable", async () => {
  const router = createIntentRouter();
  expect(router.target(show)).toBeUndefined();
  await expect(router.raise(show, { symbol: "AAPL" })).resolves.toEqual({
    status: "unavailable",
  });
});

test("delivers the payload and requester to the answering placement", async () => {
  const router = createIntentRouter();
  const handle = vi.fn();
  router.register(show, "wdg_chart", handle);
  await expect(
    router.raise(show, { symbol: "AAPL" }, { placementId: "wdg_list" }),
  ).resolves.toEqual({ status: "handled", placementId: "wdg_chart" });
  expect(handle).toHaveBeenCalledExactlyOnceWith(
    { symbol: "AAPL" },
    { placementId: "wdg_list" },
  );
});

test("a requester never answers its own intent", async () => {
  const router = createIntentRouter();
  const handle = vi.fn();
  router.register(show, "wdg_chart", handle);
  expect(router.target(show, { placementId: "wdg_chart" })).toBeUndefined();
  await expect(
    router.raise(show, { symbol: "AAPL" }, { placementId: "wdg_chart" }),
  ).resolves.toEqual({ status: "unavailable" });
  expect(handle).not.toHaveBeenCalled();
});

test("the most recently activated placement answers; ties keep registration order", () => {
  const router = createIntentRouter();
  router.register(show, "wdg_left", vi.fn());
  router.register(show, "wdg_right", vi.fn());
  expect(router.target(show)).toBe("wdg_left");
  router.activate("wdg_right");
  expect(router.target(show)).toBe("wdg_right");
  router.activate("wdg_list");
  expect(router.target(show)).toBe("wdg_right");
  router.activate("wdg_left");
  expect(router.target(show)).toBe("wdg_left");
});

test("the default policy is a pure function of candidates and requester", () => {
  expect(
    mostRecentlyActive(
      [
        { placementId: "wdg_list", activatedAt: 9 },
        { placementId: "wdg_left", activatedAt: 0 },
        { placementId: "wdg_right", activatedAt: 4 },
      ],
      { placementId: "wdg_list" },
    ),
  ).toEqual({ placementId: "wdg_right", activatedAt: 4 });
  expect(mostRecentlyActive([], {})).toBeUndefined();
});

test("a supplied resolver replaces the default policy", () => {
  const router = createIntentRouter({
    resolve: (candidates) => candidates.at(-1),
  });
  router.register(show, "wdg_left", vi.fn());
  router.register(show, "wdg_right", vi.fn());
  router.activate("wdg_left");
  expect(router.target(show)).toBe("wdg_right");
});

test("latest delivery applies the running request and only the newest waiting one", async () => {
  const router = createIntentRouter();
  const { calls, handle } = controlled<{ symbol: string }>();
  router.register(show, "wdg_chart", handle);
  const first = router.raise(show, { symbol: "AAPL" });
  const second = router.raise(show, { symbol: "MSFT" });
  const third = router.raise(show, { symbol: "NVDA" });
  await expect(second).resolves.toEqual({ status: "superseded" });
  expect(calls.map((call) => call.payload.symbol)).toEqual(["AAPL"]);
  calls[0]!.finish();
  await expect(first).resolves.toEqual({
    status: "handled",
    placementId: "wdg_chart",
  });
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]!.payload.symbol).toBe("NVDA");
  calls[1]!.finish();
  await expect(third).resolves.toMatchObject({ status: "handled" });
});

test("each delivery runs every request in arrival order, one at a time", async () => {
  const router = createIntentRouter();
  const { calls, handle } = controlled<{ line: number }>();
  router.register(log, "wdg_log", handle);
  const outcomes = [1, 2, 3].map((line) => router.raise(log, { line }));
  for (const line of [1, 2, 3]) {
    await vi.waitFor(() => expect(calls).toHaveLength(line));
    expect(calls.at(-1)!.payload.line).toBe(line);
    calls.at(-1)!.finish();
  }
  expect((await Promise.all(outcomes)).map((o) => o.status)).toEqual([
    "handled",
    "handled",
    "handled",
  ]);
});

test("a failed request settles with its error and the lane continues", async () => {
  const router = createIntentRouter();
  const { calls, handle } = controlled<{ line: number }>();
  router.register(log, "wdg_log", handle);
  const failed = router.raise(log, { line: 1 });
  const next = router.raise(log, { line: 2 });
  calls[0]!.fail();
  await expect(failed).resolves.toEqual({
    status: "failed",
    error: new Error("offline"),
  });
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  calls[1]!.finish();
  await expect(next).resolves.toMatchObject({ status: "handled" });
});

test("unregistering settles waiting requests as unavailable and lets the running one finish", async () => {
  const router = createIntentRouter();
  const { calls, handle } = controlled<{ line: number }>();
  const unregister = router.register(log, "wdg_log", handle);
  const running = router.raise(log, { line: 1 });
  const waiting = router.raise(log, { line: 2 });
  unregister();
  unregister();
  await expect(waiting).resolves.toEqual({ status: "unavailable" });
  expect(router.target(log)).toBeUndefined();
  calls[0]!.finish();
  await expect(running).resolves.toMatchObject({ status: "handled" });
  expect(calls).toHaveLength(1);
});

test("a placement answers each intent once, and may answer again after cleanup", () => {
  const router = createIntentRouter();
  const unregister = router.register(show, "wdg_chart", vi.fn());
  expect(() => router.register(show, "wdg_chart", vi.fn())).toThrow(
    "wdg_chart already answers the Show intent.",
  );
  router.register(log, "wdg_chart", vi.fn());
  unregister();
  expect(() => router.register(show, "wdg_chart", vi.fn())).not.toThrow();
});

test("subscribers hear registrations and activation changes until they leave", () => {
  const router = createIntentRouter();
  const listener = vi.fn();
  const leave = router.subscribe(listener);
  const unregister = router.register(show, "wdg_chart", vi.fn());
  router.activate("wdg_chart");
  // Activating the already most recent placement changes nothing.
  router.activate("wdg_chart");
  unregister();
  expect(listener).toHaveBeenCalledTimes(3);
  leave();
  router.activate("wdg_list");
  expect(listener).toHaveBeenCalledTimes(3);
});
