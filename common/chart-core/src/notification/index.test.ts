// Purpose: Unit tests for generic notification event schemas
// Module:  @openchart/chart-core / notification

import { describe, expect, it } from "vitest";
import { Notification } from "./index";

describe("Notification.CreateEvent", () => {
  it("accepts a valid notification create event", () => {
    const event = Notification.CreateEvent.parse({
      schemaVersion: 1,
      userId: "user_1",
      category: "alert",
      title: "AAPL alert",
      sourceType: "alert",
      sourceId: "arl_1",
      idempotencyKey: "adl_1",
    });

    expect(event.severity).toBe("info");
    expect(event.actions).toEqual([]);
    expect(event.metadata).toEqual({});
  });

  it("requires a stable idempotency key", () => {
    expect(() =>
      Notification.CreateEvent.parse({
        schemaVersion: 1,
        userId: "user_1",
        category: "alert",
        title: "AAPL alert",
        sourceType: "alert",
        idempotencyKey: "",
      }),
    ).toThrow();
  });
});
