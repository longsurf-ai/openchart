// Purpose: Locks OAuth concurrency, attempt ownership, completion outcomes, expiry, and runtime cleanup.

import { Credential } from "@openchart/server/access/credential";
import { Cause, Deferred, Effect, Exit, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { expect, test, vi } from "vitest";
import { Integration } from "./integration";
import {
  integrationID,
  instructions,
  methodID,
  oauth,
  run,
  value,
} from "./test-fixture";

// Cancelled, expired and failed attempts surface as authorization failures, not interruptions.
const failedAuthorization = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) &&
  Option.getOrUndefined(Cause.findErrorOption(exit.cause)) instanceof
    Integration.AuthorizationError;

test("concurrent completion exchanges a code only once", () => {
  const entered = Deferred.makeUnsafe<void>();
  const gate = Deferred.makeUnsafe<Credential.OAuth>();
  const callback = vi.fn(() =>
    Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Deferred.await(gate)),
    ),
  );
  return run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      const attempt = yield* service.oauthAttempt.start({
        integrationID,
        methodID,
        inputs: {},
      });
      const first = yield* service.oauthAttempt
        .complete({ attemptID: attempt.attemptID, code: "123" })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      const second = yield* service.oauthAttempt
        .complete({ attemptID: attempt.attemptID, code: "456" })
        .pipe(Effect.flip);
      expect(second).toBeInstanceOf(Integration.AuthorizationError);
      yield* Deferred.succeed(gate, value);
      yield* Fiber.join(first);
      expect(callback).toHaveBeenCalledOnce();
      expect(
        (yield* credentials.all()).map((credential) => credential.value),
      ).toEqual([value]);
      expect(
        yield* service.oauthAttempt.getStatus(attempt.attemptID),
      ).toMatchObject({ status: "complete" });
    }),
    {
      methods: [
        oauth(Effect.succeed({ ...instructions, mode: "code", callback })),
      ],
    },
  );
});

test.each(["auto", "code"] as const)(
  "cancelling %s interrupts the exchange and prevents late persistence",
  (mode) => {
    const entered = Deferred.makeUnsafe<void>();
    const gate = Deferred.makeUnsafe<Credential.OAuth>();
    let interrupted = false;
    let closed = false;
    const callback = Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Deferred.await(gate)),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          interrupted = true;
        }),
      ),
    );
    const authorization: Integration.OAuthAuthorization =
      mode === "auto"
        ? { ...instructions, mode, callback }
        : { ...instructions, mode, callback: () => callback };
    return run(
      Effect.gen(function* () {
        const service = yield* Integration.Service;
        const credentials = yield* Credential.Service;
        const attempt = yield* service.oauthAttempt.start({
          integrationID,
          methodID,
          inputs: {},
        });
        const completion =
          mode === "code"
            ? yield* service.oauthAttempt
                .complete({ attemptID: attempt.attemptID, code: "123" })
                .pipe(Effect.exit, Effect.forkScoped)
            : undefined;
        yield* Deferred.await(entered);
        yield* service.oauthAttempt.cancel(attempt.attemptID);
        expect(interrupted).toBe(true);
        expect(closed).toBe(true);
        yield* Deferred.succeed(gate, value);
        if (completion)
          expect(failedAuthorization(yield* Fiber.join(completion))).toBe(true);
        expect(yield* credentials.all()).toEqual([]);
        expect(
          Exit.isFailure(
            yield* service.oauthAttempt
              .getStatus(attempt.attemptID)
              .pipe(Effect.exit),
          ),
        ).toBe(true);
      }),
      {
        methods: [
          oauth(
            Effect.addFinalizer(() =>
              Effect.sync(() => {
                closed = true;
              }),
            ).pipe(Effect.as(authorization)),
          ),
        ],
      },
    );
  },
);

test.each(["auto", "code"] as const)(
  "expires %s attempts after ten minutes and scrubs terminal state after one minute",
  (mode) => {
    let interrupted = false;
    const closed = Deferred.makeUnsafe<void>();
    const callback = Effect.never.pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          interrupted = true;
        }),
      ),
    );
    const authorization: Integration.OAuthAuthorization =
      mode === "auto"
        ? { ...instructions, mode, callback }
        : { ...instructions, mode, callback: () => callback };
    return run(
      Effect.gen(function* () {
        const service = yield* Integration.Service;
        const credentials = yield* Credential.Service;
        const attempt = yield* service.oauthAttempt.start({
          integrationID,
          methodID,
          inputs: {},
        });
        const completion =
          mode === "code"
            ? yield* service.oauthAttempt
                .complete({ attemptID: attempt.attemptID, code: "123" })
                .pipe(Effect.exit, Effect.forkScoped)
            : undefined;
        yield* TestClock.adjust("9 minutes");
        expect(
          yield* service.oauthAttempt.getStatus(attempt.attemptID),
        ).toMatchObject({ status: "pending" });
        yield* TestClock.adjust("1 minute");
        yield* Deferred.await(closed);
        expect(interrupted).toBe(true);
        expect(
          yield* service.oauthAttempt.getStatus(attempt.attemptID),
        ).toEqual({ status: "expired", time: attempt.time });
        if (completion)
          expect(failedAuthorization(yield* Fiber.join(completion))).toBe(true);
        expect(yield* credentials.all()).toEqual([]);
        yield* TestClock.adjust("1 minute");
        expect(
          Exit.isFailure(
            yield* service.oauthAttempt
              .getStatus(attempt.attemptID)
              .pipe(Effect.exit),
          ),
        ).toBe(true);
      }),
      {
        methods: [
          oauth(
            Effect.addFinalizer(() => Deferred.succeed(closed, undefined)).pipe(
              Effect.as(authorization),
            ),
          ),
        ],
      },
    );
  },
);

test("completed attempts retain terminal status for one minute", () => {
  const closed = Deferred.makeUnsafe<void>();
  return run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const attempt = yield* service.oauthAttempt.start({
        integrationID,
        methodID,
        inputs: {},
      });
      yield* Deferred.await(closed);
      yield* TestClock.adjust("30 seconds");
      expect(
        yield* service.oauthAttempt.getStatus(attempt.attemptID),
      ).toMatchObject({ status: "complete" });
      yield* TestClock.adjust("30 seconds");
      expect(
        Exit.isFailure(
          yield* service.oauthAttempt
            .getStatus(attempt.attemptID)
            .pipe(Effect.exit),
        ),
      ).toBe(true);
    }),
    {
      methods: [
        oauth(
          Effect.addFinalizer(() => Deferred.succeed(closed, undefined)).pipe(
            Effect.as({
              ...instructions,
              mode: "auto",
              callback: Effect.succeed(value),
            }),
          ),
        ),
      ],
    },
  );
});

test("an attempt expires at its advertised deadline even between scrub ticks", () => {
  const callback = vi.fn(() => Effect.succeed(value));
  return run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      const previous = { ...value, access: "previous-access-token" };
      yield* credentials.create({ integrationID, value: previous });
      yield* TestClock.adjust("1 second");
      const attempt = yield* service.oauthAttempt.start({
        integrationID,
        methodID,
        inputs: {},
      });
      yield* TestClock.adjust("10 minutes");
      const exit = yield* service.oauthAttempt
        .complete({ attemptID: attempt.attemptID, code: "123" })
        .pipe(Effect.exit);
      expect(failedAuthorization(exit)).toBe(true);
      expect(callback).not.toHaveBeenCalled();
      expect(yield* service.oauthAttempt.getStatus(attempt.attemptID)).toEqual({
        status: "expired",
        time: attempt.time,
      });
      expect(
        (yield* credentials.all()).map((credential) => credential.value),
      ).toEqual([previous]);
    }),
    {
      methods: [
        oauth(Effect.succeed({ ...instructions, mode: "code", callback })),
      ],
    },
  );
});

test.each(["auto", "code"] as const)(
  "a %s callback that finishes at expiry cannot replace saved credentials before the next scrub",
  (mode) => {
    const entered = Deferred.makeUnsafe<void>();
    const gate = Deferred.makeUnsafe<Credential.OAuth>();
    const closed = Deferred.makeUnsafe<void>();
    const callback = Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Deferred.await(gate)),
    );
    const authorization: Integration.OAuthAuthorization =
      mode === "auto"
        ? { ...instructions, mode, callback }
        : { ...instructions, mode, callback: () => callback };
    return run(
      Effect.gen(function* () {
        const service = yield* Integration.Service;
        const credentials = yield* Credential.Service;
        const previous = { ...value, access: "previous-access-token" };
        yield* credentials.create({ integrationID, value: previous });
        yield* TestClock.adjust("1 second");
        const attempt = yield* service.oauthAttempt.start({
          integrationID,
          methodID,
          inputs: {},
        });
        const completion =
          mode === "code"
            ? yield* service.oauthAttempt
                .complete({ attemptID: attempt.attemptID, code: "123" })
                .pipe(Effect.exit, Effect.forkScoped)
            : undefined;
        yield* Deferred.await(entered);
        yield* TestClock.adjust("10 minutes");
        yield* Deferred.succeed(gate, value);
        yield* Deferred.await(closed);
        if (completion)
          expect(failedAuthorization(yield* Fiber.join(completion))).toBe(true);
        expect(
          yield* service.oauthAttempt.getStatus(attempt.attemptID),
        ).toEqual({ status: "expired", time: attempt.time });
        expect(
          (yield* credentials.all()).map((credential) => credential.value),
        ).toEqual([previous]);
      }),
      {
        methods: [
          oauth(
            Effect.addFinalizer(() => Deferred.succeed(closed, undefined)).pipe(
              Effect.as(authorization),
            ),
          ),
        ],
      },
    );
  },
);

test("request interruption leaves code completion owned by the service", () => {
  const entered = Deferred.makeUnsafe<void>();
  const gate = Deferred.makeUnsafe<Credential.OAuth>();
  const closed = Deferred.makeUnsafe<void>();
  return run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      const attempt = yield* service.oauthAttempt.start({
        integrationID,
        methodID,
        inputs: {},
      });
      const request = yield* service.oauthAttempt
        .complete({ attemptID: attempt.attemptID, code: "123" })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(request);
      yield* Deferred.succeed(gate, value);
      yield* Deferred.await(closed);
      expect(
        yield* service.oauthAttempt.getStatus(attempt.attemptID),
      ).toMatchObject({ status: "complete" });
      expect(yield* credentials.all()).toHaveLength(1);
    }),
    {
      methods: [
        oauth(
          Effect.addFinalizer(() => Deferred.succeed(closed, undefined)).pipe(
            Effect.as({
              ...instructions,
              mode: "code",
              callback: () =>
                Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Deferred.await(gate)),
                ),
            }),
          ),
        ),
      ],
    },
  );
});

test("completion succeeds only for a stored credential and repeats only after success", () => {
  const callback = vi.fn((code: string) =>
    code === "good"
      ? Effect.succeed(value)
      : Effect.fail(new Error("Rejected code")),
  );
  return run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      const start = service.oauthAttempt.start({
        integrationID,
        methodID,
        inputs: {},
      });
      const complete = (attemptID: Integration.OAuthAttemptID, code: string) =>
        service.oauthAttempt.complete({ attemptID, code }).pipe(Effect.exit);
      const accepted = yield* start;
      expect(Exit.isSuccess(yield* complete(accepted.attemptID, "good"))).toBe(
        true,
      );
      expect(Exit.isSuccess(yield* complete(accepted.attemptID, "good"))).toBe(
        true,
      );
      const rejected = yield* start;
      expect(
        failedAuthorization(yield* complete(rejected.attemptID, "bad")),
      ).toBe(true);
      expect(
        failedAuthorization(yield* complete(rejected.attemptID, "good")),
      ).toBe(true);
      const cancelled = yield* start;
      yield* service.oauthAttempt.cancel(cancelled.attemptID);
      expect(
        failedAuthorization(yield* complete(cancelled.attemptID, "good")),
      ).toBe(true);
      expect(callback).toHaveBeenCalledTimes(2);
      expect(yield* credentials.all()).toHaveLength(1);
    }),
    {
      methods: [
        oauth(Effect.succeed({ ...instructions, mode: "code", callback })),
      ],
    },
  );
});

test.each(["auto", "code"] as const)(
  "runtime disposal interrupts pending %s callbacks and waits for finalizers",
  async (mode) => {
    let interrupted = false;
    let closed = false;
    const entered = Deferred.makeUnsafe<void>();
    const callback = Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          interrupted = true;
        }),
      ),
    );
    const authorization: Integration.OAuthAuthorization =
      mode === "auto"
        ? { ...instructions, mode, callback }
        : { ...instructions, mode, callback: () => callback };
    await run(
      Effect.gen(function* () {
        const service = yield* Integration.Service;
        const attempt = yield* service.oauthAttempt.start({
          integrationID,
          methodID,
          inputs: {},
        });
        if (mode === "code")
          yield* service.oauthAttempt
            .complete({ attemptID: attempt.attemptID, code: "123" })
            .pipe(Effect.exit, Effect.forkScoped);
        yield* Deferred.await(entered);
      }),
      {
        methods: [
          oauth(
            Effect.addFinalizer(() =>
              Effect.sync(() => {
                closed = true;
              }),
            ).pipe(Effect.as(authorization)),
          ),
        ],
      },
    );
    expect(interrupted).toBe(true);
    expect(closed).toBe(true);
  },
);
