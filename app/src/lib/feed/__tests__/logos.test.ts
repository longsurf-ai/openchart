// Purpose: Exercise logo resolution through the real Provider, Catalog, Feed and browser transport.
import { once } from "node:events";
import { ClientFailures } from "@openchart/feed";
import { ConfigProvider } from "effect";
import { expect, test, vi } from "vitest";
import { createServer } from "@openchart/server";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { createTransport } from "@openchart/app/lib/transport/transport";
import { FeedTransport } from "@openchart/app/lib/feed/transport";

test("resolves offline bundled logos through HTTP and rejects invalid identifiers", async () => {
  const server = await createServer({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({
      providers: { binance: { enabled: false }, yfinance: { enabled: false } },
    }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const transport = createTransport({
    origin: `http://127.0.0.1:${address.port}`,
  });
  const client = new FeedTransport(transport).client();
  try {
    await vi.waitFor(async () =>
      expect(
        await client.logos.getLogo({ identifier: "BTCUSDT" }),
      ).toMatchObject({ id: "crypto:btc" }),
    );
    expect(await client.logos.getLogo({ identifier: "Apple" })).toMatchObject({
      id: "brand:apple.com",
    });
    expect(
      await client.logos.getLogo({ identifier: "no such logo 908172" }),
    ).toBeNull();
    await expect(
      transport.rpc.feed.logos.get.query({ identifier: "   " }),
    ).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    client.close();
    await expect(
      client.logos.getLogo({ identifier: "BTC" }),
    ).rejects.toBeInstanceOf(ClientFailures.Cancelled);
  } finally {
    client.close();
    transport.hose.disconnect();
    await server.shutdown();
  }
}, 30_000);
