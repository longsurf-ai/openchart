// Purpose: Verifies OAuth authorization, completion, errors, and persistence through the public Service.

import { Credential } from "@openchart/server/access/credential";
import { Database } from "@openchart/server/db";
import { Events } from "@openchart/server/events";
import { sql } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Fiber, Stream } from "effect";
import { expect, test, vi } from "vitest";
import { Integration } from "./integration";
import { Event } from "./events";
import {
  integrationID,
  instructions,
  methodID,
  oauth,
  run,
  value,
} from "./test-fixture";

test.each([undefined, "Personal"])(
  "completes code OAuth once with inputs, tokens, and label %s",
  async (label) => {
    const closed = Deferred.makeUnsafe<void>();
    const callback = vi.fn((code: string) =>
      Effect.succeed({ ...value, metadata: { code } }),
    );
    const authorize = vi.fn(() =>
      Effect.addFinalizer(() => Deferred.succeed(closed, undefined)).pipe(
        Effect.as({ ...instructions, mode: "code" as const, callback }),
      ),
    );
    await run(
      Effect.gen(function* () {
        const service = yield* Integration.Service;
        const credentials = yield* Credential.Service;
        const events = yield* Events.Service;
        const stream = yield* events.allBounded(8);
        const observed = yield* stream.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.forkScoped,
        );
        const attempt = yield* service.oauthAttempt.start({
          integrationID,
          methodID,
          inputs: { organization: "work" },
          label,
        });
        expect(authorize).toHaveBeenCalledExactlyOnceWith({
          organization: "work",
        });
        expect(attempt).toMatchObject({
          ...instructions,
          mode: "code",
          time: { created: 0, expires: 600_000 },
        });
        expect(attempt.attemptID).toMatch(/^con_/);
        expect(
          yield* service.oauthAttempt.getStatus(attempt.attemptID),
        ).toEqual({ status: "pending", time: attempt.time });
        yield* service.oauthAttempt.complete({
          attemptID: attempt.attemptID,
          code: "1234",
        });
        yield* Deferred.await(closed);
        expect(
          yield* service.oauthAttempt.getStatus(attempt.attemptID),
        ).toEqual({ status: "complete", time: attempt.time });
        const saved = yield* credentials.list(integrationID);
        expect(saved).toEqual([
          expect.objectContaining({
            integrationID,
            label: label ?? "Derived",
            value: { ...value, metadata: { code: "1234" } },
          }),
        ]);
        yield* service.oauthAttempt.complete({
          attemptID: attempt.attemptID,
          code: "again",
        });
        yield* service.oauthAttempt.cancel(attempt.attemptID);
        expect(callback).toHaveBeenCalledExactlyOnceWith("1234");
        expect(yield* credentials.list(integrationID)).toEqual(saved);
        expect(
          (yield* Fiber.join(observed)).map((event) => event.type),
        ).toEqual([Event.Updated.type]);
      }),
      {
        methods: [
          { ...oauth(Effect.never), authorize, label: () => "Derived" },
        ],
      },
    );
  },
);

test("missing code preserves the attempt and cancel awaits its cleanup", () => {
  let closed = false;
  const callback = vi.fn(() => Effect.succeed(value));
  return run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      const attempt = yield* service.oauthAttempt.start({
        integrationID,
        methodID,
        inputs: {},
      });
      const error = yield* service.oauthAttempt
        .complete({ attemptID: attempt.attemptID })
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(Integration.CodeRequiredError);
      if (!(error instanceof Integration.CodeRequiredError))
        throw new Error("Expected code-required failure");
      expect(error.attemptID).toBe(attempt.attemptID);
      expect(closed).toBe(false);
      expect(
        yield* service.oauthAttempt.getStatus(attempt.attemptID),
      ).toMatchObject({ status: "pending" });
      yield* service.oauthAttempt.cancel(attempt.attemptID);
      yield* service.oauthAttempt.cancel(attempt.attemptID);
      expect(closed).toBe(true);
      expect(callback).not.toHaveBeenCalled();
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
          ).pipe(Effect.as({ ...instructions, mode: "code", callback })),
        ),
      ],
    },
  );
});

test("auto OAuth survives the start request and completes in the background", () => {
  const gate = Deferred.makeUnsafe<Credential.OAuth>();
  const closed = Deferred.makeUnsafe<void>();
  return run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      const attempt = yield* Effect.scoped(
        service.oauthAttempt.start({ integrationID, methodID, inputs: {} }),
      );
      expect(
        yield* service.oauthAttempt.getStatus(attempt.attemptID),
      ).toMatchObject({ status: "pending" });
      expect(yield* credentials.all()).toEqual([]);
      yield* Deferred.succeed(gate, value);
      yield* Deferred.await(closed);
      expect(yield* service.oauthAttempt.getStatus(attempt.attemptID)).toEqual({
        status: "complete",
        time: attempt.time,
      });
      expect(yield* credentials.list(integrationID)).toEqual([
        expect.objectContaining({ label: "default", value }),
      ]);
    }),
    {
      methods: [
        oauth(
          Effect.addFinalizer(() => Deferred.succeed(closed, undefined)).pipe(
            Effect.as({
              ...instructions,
              mode: "auto",
              callback: Deferred.await(gate),
            }),
          ),
        ),
      ],
    },
  );
});

test.each(["auto", "code"] as const)(
  "failed %s OAuth closes resources without replacing a saved credential",
  (mode) => {
    const closed = Deferred.makeUnsafe<void>();
    const failure = new Error("Remote authorization rejected");
    const callback = Effect.fail(failure);
    const authorization: Integration.OAuthAuthorization =
      mode === "auto"
        ? { ...instructions, mode, callback }
        : { ...instructions, mode, callback: () => callback };
    return run(
      Effect.gen(function* () {
        const service = yield* Integration.Service;
        const credentials = yield* Credential.Service;
        const saved = yield* credentials.create({
          integrationID,
          value: Credential.Key.make({ type: "key", key: "old" }),
        });
        const attempt = yield* service.oauthAttempt.start({
          integrationID,
          methodID,
          inputs: {},
        });
        if (mode === "code") {
          const error = yield* service.oauthAttempt
            .complete({ attemptID: attempt.attemptID, code: "123" })
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(Integration.AuthorizationError);
          expect(error.cause).toBe(failure);
        }
        yield* Deferred.await(closed);
        expect(
          yield* service.oauthAttempt.getStatus(attempt.attemptID),
        ).toMatchObject({ status: "failed", message: expect.any(String) });
        expect(yield* credentials.list(integrationID)).toEqual([saved]);
        yield* service.oauthAttempt.complete({
          attemptID: attempt.attemptID,
          code: "retry",
        });
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

test("failed authorize closes its scope and preserves the original typed cause", () => {
  let closed = false;
  const cause = new Error("Could not start");
  return run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const error = yield* service.oauthAttempt
        .start({ integrationID, methodID, inputs: {} })
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(Integration.AuthorizationError);
      expect(error.cause).toBe(cause);
      expect(closed).toBe(true);
    }),
    {
      methods: [
        oauth(
          Effect.addFinalizer(() =>
            Effect.sync(() => {
              closed = true;
            }),
          ).pipe(Effect.andThen(Effect.fail(cause))),
        ),
      ],
    },
  );
});

test("unknown OAuth methods and attempts preserve upstream defects and missing cancel is a no-op", () =>
  run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const missing = Integration.OAuthAttemptID.create();
      for (const operation of [
        service.oauthAttempt.start({ integrationID, methodID, inputs: {} }),
        service.oauthAttempt.getStatus(missing),
        service.oauthAttempt.complete({ attemptID: missing, code: "123" }),
      ]) {
        const exit = yield* operation.pipe(Effect.exit);
        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      }
      yield* service.oauthAttempt.cancel(missing);
    }),
  ));

test("persistence failure never reports complete, retains the old credential, and closes resources", () => {
  const closed = Deferred.makeUnsafe<void>();
  return run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      const { db } = yield* Database.Service;
      const saved = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "old" }),
      });
      yield* db.run(
        sql`CREATE TEMP TRIGGER reject_integration_credential BEFORE INSERT ON credential BEGIN SELECT RAISE(ABORT, 'test rejection'); END`,
      );
      const attempt = yield* service.oauthAttempt.start({
        integrationID,
        methodID,
        inputs: {},
      });
      const exit = yield* service.oauthAttempt
        .complete({ attemptID: attempt.attemptID, code: "123" })
        .pipe(Effect.exit);
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(
        Credential.StorageFailed,
      );
      yield* Deferred.await(closed);
      expect(
        yield* service.oauthAttempt.getStatus(attempt.attemptID),
      ).toMatchObject({ status: "failed" });
      expect(yield* credentials.list(integrationID)).toEqual([saved]);
    }),
    {
      methods: [
        oauth(
          Effect.addFinalizer(() => Deferred.succeed(closed, undefined)).pipe(
            Effect.as({
              ...instructions,
              mode: "code",
              callback: () => Effect.succeed(value),
            }),
          ),
        ),
      ],
    },
  );
});

test("a throwing code callback settles as failed and closes the attempt", () => {
  let closed = false;
  const cause = new Error("Broken code callback");
  return run(
    Effect.gen(function* () {
      const service = yield* Integration.Service;
      const credentials = yield* Credential.Service;
      const attempt = yield* service.oauthAttempt.start({
        integrationID,
        methodID,
        inputs: {},
      });
      const exit = yield* service.oauthAttempt
        .complete({ attemptID: attempt.attemptID, code: "123" })
        .pipe(Effect.exit);
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      expect(
        yield* service.oauthAttempt.getStatus(attempt.attemptID),
      ).toMatchObject({ status: "failed", message: cause.message });
      expect(closed).toBe(true);
      expect(yield* credentials.all()).toEqual([]);
    }),
    {
      methods: [
        oauth(
          Effect.addFinalizer(() =>
            Effect.sync(() => {
              closed = true;
            }),
          ).pipe(
            Effect.as({
              ...instructions,
              mode: "code",
              callback: () => {
                throw cause;
              },
            }),
          ),
        ),
      ],
    },
  );
});
