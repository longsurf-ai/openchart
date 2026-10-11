// Purpose: Queued edits must use the saved or refreshed revision across widget instances.
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";

import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  watchlistDetail,
  watchlistMutation,
  type Watchlist,
} from "../api/queries";

test("a queued edit waits for conflict recovery before reading its revision", async () => {
  const original = {
    id: "wtl_test",
    revision: 1,
    name: "Markets",
    columns: [],
    sections: [],
  } as unknown as Watchlist;
  const current = { ...original, revision: 2, name: "Renamed elsewhere" };
  let refresh!: (watchlist: Watchlist) => void;
  const get = vi
    .fn()
    .mockResolvedValueOnce(original)
    .mockImplementationOnce(
      () =>
        new Promise<Watchlist>((resolve) => {
          refresh = resolve;
        }),
    );
  const patch = vi
    .fn()
    .mockRejectedValueOnce(new Error("Revision conflict"))
    .mockResolvedValueOnce({ ...current, revision: 3 });
  const transport = {
    rpc: {
      resources: {
        watchlist: { get: { query: get }, patch: { mutate: patch } },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await client.fetchQuery(watchlistDetail(transport, original.id));
  const first = new MutationObserver(
    client,
    watchlistMutation(transport, client, original.id),
  );
  const second = new MutationObserver(
    client,
    watchlistMutation(transport, client, original.id),
  );
  const rejected = first
    .mutate(() => [{ op: "replace", path: "/name", value: "First" }])
    .catch((error: unknown) => error);
  const queued = second.mutate((watchlist) => [
    { op: "replace", path: "/name", value: `${watchlist.name}!` },
  ]);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(patch).toHaveBeenCalledTimes(1);
  refresh(current);
  expect(await rejected).toEqual(new Error("Revision conflict"));
  await queued;
  expect(patch).toHaveBeenLastCalledWith({
    id: original.id,
    expectedRevision: 2,
    operations: [{ op: "replace", path: "/name", value: "Renamed elsewhere!" }],
  });
  client.clear();
});
