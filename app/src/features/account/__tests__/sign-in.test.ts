// Purpose: Verify saved-key restoration, secret reuse and cancellation at the frontend handoff.
import { describe, expect, it, vi } from "vitest";

import { createSignInFlow } from "@openchart/app/features/account/sign-in";

function fixture() {
  const user = {
    id: "user-1",
    firstName: "Test",
    lastName: "User",
    primaryEmailAddress: { emailAddress: "test@example.com" },
  };
  const auth = {
    getState: { query: vi.fn(async () => ({ status: "signed-out" })) },
    getSavedKey: {
      query: vi.fn(async (): Promise<{ apiKeyID: string } | null> => null),
    },
    restoreSignIn: { mutate: vi.fn(async () => {}) },
    completeSignIn: {
      mutate: vi.fn<(input: unknown) => Promise<void>>(async () => {}),
    },
  };
  const saved = {
    id: "saved-key",
    subject: user.id,
    revoked: false,
    expired: false,
  };
  const clerk = {
    user,
    apiKeys: {
      create: vi.fn(async () => ({ id: "new-key", secret: "test-secret" })),
      getAll: vi.fn(async () => ({ data: [saved], total_count: 1 })),
    },
  };
  const flow = createSignInFlow(
    auth as unknown as Parameters<typeof createSignInFlow>[0],
    clerk as unknown as Parameters<typeof createSignInFlow>[1],
  );
  return { flow, auth, clerk, saved };
}

describe("desktop account handoff", () => {
  it("restores the matching valid key without issuing another", async () => {
    const { flow, auth, clerk } = fixture();
    auth.getSavedKey.query.mockResolvedValue({ apiKeyID: "saved-key" });
    await flow.complete();
    expect(auth.restoreSignIn.mutate).toHaveBeenCalledWith({
      userID: "user-1",
      apiKeyID: "saved-key",
    });
    expect(clerk.apiKeys.create).not.toHaveBeenCalled();
    expect(auth.completeSignIn.mutate).not.toHaveBeenCalled();
  });

  it("searches later Clerk pages before replacing a saved key", async () => {
    const { flow, auth, clerk, saved } = fixture();
    auth.getSavedKey.query.mockResolvedValue({ apiKeyID: saved.id });
    clerk.apiKeys.getAll.mockResolvedValueOnce({
      data: Array.from({ length: 100 }, (_, i) => ({
        ...saved,
        id: `other-${i}`,
      })),
      total_count: 101,
    });
    await flow.complete();
    expect(clerk.apiKeys.getAll).toHaveBeenLastCalledWith({
      subject: "user-1",
      initialPage: 2,
      pageSize: 100,
    });
    expect(auth.restoreSignIn.mutate).toHaveBeenCalledOnce();
    expect(clerk.apiKeys.create).not.toHaveBeenCalled();
  });

  it.each(["revoked", "expired"] as const)(
    "replaces a confirmed %s key",
    async (reason) => {
      const { flow, auth, clerk, saved } = fixture();
      auth.getSavedKey.query.mockResolvedValue({ apiKeyID: saved.id });
      saved[reason] = true;
      await flow.complete();
      expect(auth.restoreSignIn.mutate).not.toHaveBeenCalled();
      expect(clerk.apiKeys.create).toHaveBeenCalledWith({
        name: expect.stringContaining("OpenChart Desktop "),
        subject: "user-1",
      });
      expect(auth.completeSignIn.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ apiKeyID: "new-key", key: "test-secret" }),
      );
    },
  );

  it("keeps an unavailable status check as an error, without minting a replacement", async () => {
    const { flow, auth, clerk } = fixture();
    auth.getSavedKey.query.mockResolvedValue({ apiKeyID: "saved-key" });
    clerk.apiKeys.getAll.mockRejectedValue(new Error("offline"));
    await expect(flow.complete()).rejects.toThrow("offline");
    expect(clerk.apiKeys.create).not.toHaveBeenCalled();
    expect(auth.restoreSignIn.mutate).not.toHaveBeenCalled();
  });

  it("retries local storage using the same secret", async () => {
    const { flow, auth, clerk } = fixture();
    auth.completeSignIn.mutate.mockRejectedValueOnce(
      new Error("storage failed"),
    );
    await expect(flow.complete()).rejects.toThrow("storage failed");
    await flow.complete();
    expect(clerk.apiKeys.create).toHaveBeenCalledOnce();
    expect(auth.completeSignIn.mutate).toHaveBeenCalledTimes(2);
    expect(auth.completeSignIn.mutate.mock.calls[0]).toEqual(
      auth.completeSignIn.mutate.mock.calls[1],
    );
  });

  it("does not duplicate concurrent login completion", async () => {
    const { flow, clerk } = fixture();
    await Promise.all([flow.complete(), flow.complete()]);
    expect(clerk.apiKeys.create).toHaveBeenCalledOnce();
  });

  it("does not write a key that arrives after logout", async () => {
    const { flow, auth, clerk } = fixture();
    let resolve!: (key: { id: string; secret: string }) => void;
    clerk.apiKeys.create.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const completion = flow.complete();
    await vi.waitFor(() => expect(clerk.apiKeys.create).toHaveBeenCalledOnce());
    flow.setActive(false);
    resolve({ id: "late", secret: "late-secret" });
    await completion;
    expect(auth.completeSignIn.mutate).not.toHaveBeenCalled();
  });

  it("does not restore a key when its status arrives after logout", async () => {
    const { flow, auth, clerk, saved } = fixture();
    auth.getSavedKey.query.mockResolvedValue({ apiKeyID: saved.id });
    let resolve!: (page: {
      data: (typeof saved)[];
      total_count: number;
    }) => void;
    clerk.apiKeys.getAll.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const completion = flow.complete();
    await vi.waitFor(() => expect(clerk.apiKeys.getAll).toHaveBeenCalledOnce());
    flow.setActive(false);
    resolve({ data: [saved], total_count: 1 });
    await completion;
    expect(auth.restoreSignIn.mutate).not.toHaveBeenCalled();
    expect(clerk.apiKeys.create).not.toHaveBeenCalled();
  });
});
