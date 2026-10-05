// Purpose: Configure the native bridge with the bundled Clerk instance and redirect.
import { createClerkBridge } from "@clerk/electron";
import { afterEach, expect, test, vi } from "vitest";

import { configureClerk } from "./clerk";

vi.mock("electron", () => ({
  app: { getPath: () => "/profile" },
  session: {},
}));
vi.mock("@clerk/electron", () => ({
  createClerkBridge: vi.fn(() => ({ cleanup: vi.fn() })),
}));
vi.mock("@clerk/electron/storage", () => ({ storage: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

test.each(["openchart-dev", "openchart"])(
  "uses the bundled instance with the %s callback",
  (scheme) => {
    const publishableKey = `pk_test_${Buffer.from("test.clerk.accounts.dev$").toString("base64")}`;
    vi.stubEnv("OPENCHART_CLERK_PUBLISHABLE_KEY", publishableKey);
    const clerk = configureClerk(scheme);
    expect(clerk.publishableKey).toBe(publishableKey);
    expect(clerk.origin).toBe("https://test.clerk.accounts.dev");
    expect(createClerkBridge).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        renderer: {
          scheme,
          host: "app",
          privileges: { allowServiceWorkers: true },
        },
        oauthRedirectUrl:
          scheme === "openchart-dev"
            ? "https://longsurf.ai/auth/return/?app=development"
            : "https://longsurf.ai/auth/return/",
      }),
    );
    clerk.cleanup();
    expect(
      vi.mocked(createClerkBridge).mock.results[0]!.value.cleanup,
    ).toHaveBeenCalledOnce();
  },
);
