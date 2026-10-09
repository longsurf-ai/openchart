// Purpose: Access grants come from admission; recovery actions require billing facts, never guesses.
import { Effect, Stream } from "effect";
import { expect, test, vi } from "vitest";
import { Billing } from "@openchart/server/access/billing";
import { OpenChartClient } from "./client";
import { makeAccessCheck } from "./access";
import {
  CredentialUnavailable,
  OpenChartRejected,
  OpenChartUnavailable,
} from "./errors";

function fixture(
  status = 403,
  subscription: Billing.Subscription = { status: "none" },
) {
  const getSubscription = vi.fn<Billing.Interface["getSubscription"]>(() =>
    Effect.succeed(subscription),
  );
  const getCapabilities = vi.fn(() =>
    status === 200
      ? Effect.succeed({
          resolutions: [],
          historyAdjustments: [],
          liveAdjustments: [],
          adjustedLiveResolutions: [],
          sessions: ["regular", "extended", "24h"] as const,
          maxHistoryRows: 100,
          maxConnectionSeconds: 60,
        })
      : status === 0
        ? Effect.fail(new CredentialUnavailable({ reason: "missing" }))
        : Effect.fail(new OpenChartRejected({ status })),
  );
  const client = OpenChartClient.of({
    changes: Stream.never,
    getCapabilities,
    reset: () => Effect.die("unused"),
    searchListings: () => Effect.die("unused"),
    readCalendar: () => Effect.die("unused"),
    readBarsPage: () => Effect.die("unused"),
    subscribeBars: () => Effect.die("unused"),
  });
  const billing = Billing.Service.of({
    getSubscription,
    getAccess: () => Effect.die("unused"),
    getReferrals: () => Effect.die("unused"),
    issueReferrals: () => Effect.die("unused"),
    redeemReferral: () => Effect.die("unused"),
    createCheckout: () => Effect.die("unused"),
    createPortal: () => Effect.die("unused"),
  });
  const check = makeAccessCheck.pipe(
    Effect.flatMap((checkAccess) => checkAccess()),
    Effect.provideService(OpenChartClient, client),
    Effect.provideService(Billing.Service, billing),
  );
  return { check, client, billing, getSubscription, getCapabilities };
}

const subscribed = (
  status: Exclude<Billing.Subscription["status"], "none">,
): Billing.Subscription => ({
  status,
  planId: "openchart",
  interval: "month",
  currentPeriodStart: "2026-10-01T00:00:00.000Z",
  currentPeriodEnd: "2026-11-01T00:00:00.000Z",
  cancelAtPeriodEnd: true,
  cancelAt: null,
});

test("a missing credential requires sign-in without billing", async () => {
  const f = fixture(0);
  expect(await Effect.runPromise(f.check)).toEqual({
    status: "required",
    action: "sign-in",
  });
  expect(f.getSubscription).not.toHaveBeenCalled();
});

test("rejected and unresolvable credentials are errors without billing", async () => {
  const rejected = fixture(401);
  await expect(Effect.runPromise(rejected.check)).rejects.toMatchObject({
    reason: { _tag: "Dataset.AccessDenied" },
  });
  expect(rejected.getSubscription).not.toHaveBeenCalled();
  const unavailable = fixture();
  unavailable.client.getCapabilities = () =>
    Effect.fail(new CredentialUnavailable({ reason: "unavailable" }));
  await expect(Effect.runPromise(unavailable.check)).rejects.toMatchObject({
    reason: { _tag: "Dataset.Unavailable" },
  });
  expect(unavailable.getSubscription).not.toHaveBeenCalled();
});

test("admission grants access without interpreting a billing summary", async () => {
  const f = fixture(200);
  expect(await Effect.runPromise(f.check)).toEqual({ status: "granted" });
  expect(f.getSubscription).not.toHaveBeenCalled();
});

test.each(["none", "canceled", "incomplete_expired"] as const)(
  "denied %s accounts can subscribe",
  async (status) => {
    const f = fixture(403, status === "none" ? { status } : subscribed(status));
    expect(await Effect.runPromise(f.check)).toEqual({
      status: "required",
      action: "subscribe",
    });
  },
);

test.each(["past_due", "unpaid", "paused", "incomplete"] as const)(
  "denied %s accounts manage existing billing",
  async (status) => {
    const f = fixture(403, subscribed(status));
    expect(await Effect.runPromise(f.check)).toEqual({
      status: "required",
      action: "manage-subscription",
    });
  },
);

test.each(["active", "trialing"] as const)(
  "a denial for %s is an error, never a second subscription",
  async (status) => {
    const f = fixture(403, subscribed(status));
    await expect(Effect.runPromise(f.check)).rejects.toMatchObject({
      reason: { _tag: "Dataset.AccessDenied" },
    });
  },
);

test("network and billing failures never become subscription requirements", async () => {
  const network = fixture();
  network.client.getCapabilities = () =>
    Effect.fail(new OpenChartUnavailable({}));
  await expect(Effect.runPromise(network.check)).rejects.toMatchObject({
    reason: { _tag: "Dataset.Unavailable" },
  });
  expect(network.getSubscription).not.toHaveBeenCalled();
  const billing = fixture();
  billing.getSubscription.mockImplementation(() =>
    Effect.fail(new Billing.OperationFailed({ reason: "network" })),
  );
  await expect(Effect.runPromise(billing.check)).rejects.toMatchObject({
    reason: { _tag: "Dataset.AccessDenied" },
  });
});
