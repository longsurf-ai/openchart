// Purpose: Verifies Trigger matching, serialization, targets, isolation, and the orphan sweep through Trigger.Service.

import { Publisher } from "@openchart/server/agent/publisher/publisher";
import { AgentRunStore } from "@openchart/server/agent/run/store";
import { agentRun } from "@openchart/server/agent/schema";
import { Session } from "@openchart/server/agent/session";
import { SessionExecution } from "@openchart/server/agent/session/execution";
import { AlertFired } from "@openchart/server/alert/events";
import { Bus } from "@openchart/server/bus";
import { Database } from "@openchart/server/db";
import { Events, SubscriberOverflowError } from "@openchart/server/events";
import { Transactor } from "@openchart/server/lib/resource";
import { Notification } from "@openchart/server/notification";
import { AlertEventId } from "@openchart/server/resources/alert-event";
import { BarsSeries } from "@openchart/feed";
import {
  AlertRuleId,
  alertRuleResource,
} from "@openchart/server/resources/alert-rule";
import { barsRuleConfig } from "@openchart/server/resources/alert-rule/alert-rule.test-utils";
import { recordAlertFire } from "@openchart/server/resources/macros/record-alert-fire";
import { triggerResource } from "@openchart/server/resources/trigger";
import { sql } from "drizzle-orm";
import {
  Deferred,
  Effect,
  Fiber,
  Layer,
  Queue,
  Schema,
  Scope,
  Stream,
  Tracer,
} from "effect";
import { afterEach, expect, test, vi } from "vitest";

import { Trigger } from "./trigger";

// Resource transitions take decoded values, including the branded provider.
const inputs = Schema.decodeUnknownSync(BarsSeries)({
  provider: "yfinance",
  listing: { symbol: "AAPL", currency: "USD" },
  resolution: "1m",
  session: "regular",
  adjustment: "raw",
});
const prompt = {
  agent: "analyst",
  model: { providerID: "codex" as const, modelID: "tier1" as const },
  parts: [{ type: "text" as const, text: "Review {symbol}." }],
};
const template = "{symbol} has exceeded {threshold} {unknown}";
const rendered = "AAPL has exceeded 200 {unknown}";

type Services =
  | Trigger.Service
  | Bus.Service
  | Notification.Service
  | Database.Service
  | AgentRunStore.Service
  | Session.Service
  | SessionExecution.Service
  | Events.Service
  | Publisher.Service
  | Scope.Scope;

function run<A, E>(program: Effect.Effect<A, E, Services>) {
  const dependencies = Layer.mergeAll(
    Database.layer(":memory:", () => Effect.void),
    Events.layer,
    Bus.layer,
    Session.layer,
    Layer.sync(Notification.Service, () => ({
      notify: vi.fn<Notification.Interface["notify"]>(() => Effect.void),
    })),
    Layer.succeed(Publisher.Service, { publish: () => Effect.void }),
    Layer.sync(SessionExecution.Service, () => ({
      active: Effect.succeed(new Set<string>()),
      wake: vi.fn<SessionExecution.Interface["wake"]>(() => Effect.void),
      interrupt: () => Effect.void,
    })),
  );
  const layer = Trigger.layer.pipe(
    Layer.provideMerge(
      AgentRunStore.layer.pipe(Layer.provideMerge(dependencies)),
    ),
  );
  return Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(layer)));
}

const createRule = () =>
  Transactor.run(
    alertRuleResource.transitions.create({
      name: "AAPL above 200",
      enabled: true,
      repeat: true,
      alertable: {
        kind: "tea",
        source: 'alertcondition(close > 200, "Above", "AAPL crossed 200")',
        config: barsRuleConfig(inputs, { threshold: 200 }),
      },
    }),
  );
const createTrigger = (
  ruleId: string,
  options: Partial<typeof triggerResource.body.Type> = {},
) =>
  Transactor.run(
    triggerResource.transitions.create({
      name: "AAPL breakout",
      enabled: true,
      event: { kind: "alert", ruleId },
      target: { kind: "notification", message: template },
      ...options,
    }),
  );
const triggerIds = Transactor.run(triggerResource.transitions.listAll()).pipe(
  Effect.map((triggers) => triggers.map((trigger) => trigger.id)),
);

/** Records one fire the way the Alert service does and returns its Bus message. */
const recordFire = Effect.fn("test.recordFire")(function* (
  rule: typeof alertRuleResource.entity.Type,
) {
  const event = yield* Transactor.run(
    recordAlertFire({
      ruleId: rule.id,
      expectedRevision: rule.revision,
      condition: "above",
      time: 60_000,
      detail: {
        title: "Above",
        message: "AAPL crossed 200",
        data: {
          symbol: "AAPL",
          inputs,
          parameters: { threshold: 200 },
          values: { close: 201.5 },
        },
      },
    }),
  );
  return { ruleId: rule.id as string, eventId: event!.id as string };
});

/** Forks run, waits for its subscription, and returns `fire`: publish one message and await its handling. */
const start = Effect.fn("test.startTrigger")(function* (overflowFirst = false) {
  const trigger = yield* Trigger.Service;
  const bus = yield* Bus.Service;
  const subscribed = yield* Deferred.make<void>();
  const handled = yield* Queue.unbounded<void>();
  const allBounded = bus.allBounded;
  const subscribe = vi
    .spyOn(bus, "allBounded")
    .mockImplementation((capacity) =>
      allBounded(capacity).pipe(
        Effect.tap(() => Deferred.succeed(subscribed, undefined)),
      ),
    );
  if (overflowFirst)
    subscribe.mockImplementationOnce((capacity) =>
      Effect.succeed(Stream.fail(new SubscriberOverflowError({ capacity }))),
    );
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (time, exit) => {
        end(time, exit);
        if (options.name === "Trigger.onAlertFired")
          Queue.offerUnsafe(handled, undefined);
      };
      return span;
    },
  });
  const fiber = yield* trigger
    .run()
    .pipe(Effect.withTracer(tracer), Effect.forkScoped);
  yield* Effect.raceFirst(Deferred.await(subscribed), Fiber.join(fiber));
  return (message: { ruleId: string; eventId: string }) =>
    bus
      .publish(AlertFired, {
        ruleId: AlertRuleId.make(message.ruleId),
        eventId: AlertEventId.make(message.eventId),
      })
      .pipe(
        Effect.andThen(
          Effect.raceFirst(Queue.take(handled), Fiber.join(fiber)),
        ),
      );
});

afterEach(() => vi.restoreAllMocks());

test.each([undefined, "glass", "none"] as const)(
  "a notification trigger renders once with sound override %s",
  (sound) =>
    run(
      Effect.gen(function* () {
        const rule = yield* createRule();
        const trigger = yield* createTrigger(rule.id, {
          target: {
            kind: "notification",
            message: template,
            ...(sound && { sound }),
          },
        });
        const notification = yield* Notification.Service;
        const fire = yield* start();
        yield* fire(yield* recordFire(rule));
        expect(notification.notify).toHaveBeenCalledTimes(1);
        expect(notification.notify).toHaveBeenCalledWith({
          title: trigger.name,
          body: rendered,
          ...(sound && { sound }),
        });
      }),
    ),
);

test("an agent_prompt trigger admits one Run per event into a chat Session; a replayed message admits nothing", () =>
  run(
    Effect.gen(function* () {
      const rule = yield* createRule();
      const trigger = yield* createTrigger(rule.id, {
        name: "Analyze AAPL",
        target: { kind: "agent_prompt", prompt },
      });
      const { db } = yield* Database.Service;
      const store = yield* AgentRunStore.Service;
      const sessions = yield* Session.Service;
      const execution = yield* SessionExecution.Service;
      const fire = yield* start();
      const message = yield* recordFire(rule);
      yield* fire(message);
      const accepted = yield* store.getByIntent(
        `trigger:${trigger.id}:${message.eventId}`,
      );
      expect(accepted).toMatchObject({
        status: "queued",
        input: {
          ...prompt,
          parts: expect.arrayContaining([
            { type: "text", text: "Review AAPL." },
          ]),
        },
      });
      expect(accepted!.input.parts).toHaveLength(3);
      expect(accepted!.input.parts.at(-1)).toMatchObject({
        type: "text",
        text: expect.stringContaining("publish_post"),
      });
      // The sidebar directory includes root chat Sessions.
      const directory = yield* sessions.list({
        kinds: ["chat", "chart_explain"],
        parentId: null,
        limit: 10,
      });
      expect(directory.items).toMatchObject([
        { id: accepted!.sessionID, title: "Analyze AAPL", bindingId: null },
      ]);
      yield* fire(message);
      expect(yield* db.select().from(agentRun)).toHaveLength(1);
      expect(
        (yield* sessions.list({
          kinds: ["chat", "chart_explain"],
          parentId: null,
          limit: 10,
        })).items,
      ).toHaveLength(1);
      // A replay repairs a missed wake; it never admits again.
      expect(execution.wake).toHaveBeenCalledTimes(2);
      // Another event of the same rule is another Run.
      yield* fire(yield* recordFire(rule));
      expect(yield* db.select().from(agentRun)).toHaveLength(2);
    }),
  ));

test("every trigger of a rule fires; one failing blocks neither the others nor later fires", () =>
  run(
    Effect.gen(function* () {
      const rule = yield* createRule();
      yield* createTrigger(rule.id, {
        target: { kind: "agent_prompt", prompt },
      });
      yield* createTrigger(rule.id, {
        name: "Second",
        target: { kind: "notification", message: "{title}" },
      });
      yield* createTrigger(rule.id, {
        name: "Third",
        target: { kind: "notification", message: "{close}" },
      });
      const { db } = yield* Database.Service;
      yield* db.run(sql`CREATE TRIGGER reject_run BEFORE INSERT ON agent_run
    BEGIN SELECT RAISE(FAIL, 'injected admission failure'); END`);
      const notification = yield* Notification.Service;
      const fire = yield* start();
      yield* fire(yield* recordFire(rule));
      expect(vi.mocked(notification.notify).mock.calls).toEqual([
        [{ title: "Second", body: "Above" }],
        [{ title: "Third", body: "201.5" }],
      ]);
      expect(yield* db.select().from(agentRun)).toHaveLength(0);
      yield* db.run(sql`DROP TRIGGER reject_run`);
      yield* fire(yield* recordFire(rule));
      expect(notification.notify).toHaveBeenCalledTimes(4);
      expect(yield* db.select().from(agentRun)).toHaveLength(1);
    }),
  ));

test("disabled triggers, triggers of another rule, and fires whose event is gone do nothing", () =>
  run(
    Effect.gen(function* () {
      const rule = yield* createRule();
      const other = yield* createRule();
      yield* createTrigger(rule.id, { enabled: false });
      yield* createTrigger(other.id, { name: "Other rule" });
      const notification = yield* Notification.Service;
      const fire = yield* start();
      yield* fire(yield* recordFire(rule));
      expect(notification.notify).not.toHaveBeenCalled();
      // Ids are branded at the publisher, so only a missing event can reach here.
      yield* fire({ ruleId: other.id, eventId: "ale_missing" });
      expect(notification.notify).not.toHaveBeenCalled();
      // The loop survived the skipped fires.
      yield* fire(yield* recordFire(other));
      expect(vi.mocked(notification.notify).mock.calls).toEqual([
        [{ title: "Other rule", body: rendered }],
      ]);
    }),
  ));

test("the startup sweep removes triggers of deleted rules and keeps the rest", () =>
  run(
    Effect.gen(function* () {
      const kept = yield* createRule();
      const deleted = yield* createRule();
      const valid = yield* createTrigger(kept.id);
      const disabled = yield* createTrigger(kept.id, { enabled: false });
      yield* createTrigger(deleted.id);
      yield* createTrigger("alr_never_existed");
      yield* Transactor.run(alertRuleResource.transitions.remove(deleted.id));
      expect(yield* triggerIds).toHaveLength(4);
      yield* start();
      expect(yield* triggerIds).toEqual([valid.id, disabled.id]);
    }),
  ));

test("an overflowed subscription is replaced and later fires are served", () =>
  run(
    Effect.gen(function* () {
      const rule = yield* createRule();
      yield* createTrigger(rule.id);
      const bus = yield* Bus.Service;
      const notification = yield* Notification.Service;
      const fire = yield* start(true);
      expect(bus.allBounded).toHaveBeenCalledTimes(2);
      yield* fire(yield* recordFire(rule));
      expect(notification.notify).toHaveBeenCalledTimes(1);
    }),
  ));
