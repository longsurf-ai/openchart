// Purpose: Ensure the retired provider cannot expose a live session through production composition.
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";
import { BarsRequest } from "@openchart/feed";
import { provisionBars } from "@openchart/server/feed/bar/provisioner";

test("retired OpenChart live sessions require another explicitly selected provider", async () => {
  const bars = await Effect.runPromise(provisionBars([]));
  const request = Schema.decodeUnknownSync(BarsRequest)({
    provider: "openchart",
    listing: { id: 12526, symbol: "AAPL", currency: "USD" },
    resolution: "1m",
    session: "regular",
    adjustment: "raw",
    from: 0,
    to: "now",
    countBack: 1,
  });
  const error = await Effect.runPromise(
    bars.observe(request).pipe(Effect.flip, Effect.scoped),
  );
  expect(error.reason._tag).toBe("Feed.SourceRetired");
  expect(error.isRetryable).toBe(false);
});
