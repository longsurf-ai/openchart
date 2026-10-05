// Purpose: Verify the test-account sign-in runs Clerk's email-code steps in order and stops at the first error.
import { expect, test, vi } from "vitest";

import { signInTestAccount } from "./test-account";

function fakeSignIn(failAt?: string) {
  const calls: string[] = [];
  const step = (name: string) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push(args.length ? `${name} ${JSON.stringify(args[0])}` : name);
      return { error: name === failAt ? new Error(`${name} failed`) : null };
    });
  const signIn = {
    create: step("create"),
    emailCode: { sendCode: step("sendCode"), verifyCode: step("verifyCode") },
    finalize: step("finalize"),
  };
  return {
    calls,
    signIn: signIn as unknown as Parameters<typeof signInTestAccount>[0],
  };
}

test("signs in with Clerk's fixed test code and activates the session", async () => {
  const { calls, signIn } = fakeSignIn();
  await signInTestAccount(signIn, "dev+clerk_test@example.com");
  expect(calls).toEqual([
    'create {"identifier":"dev+clerk_test@example.com"}',
    "sendCode",
    'verifyCode {"code":"424242"}',
    "finalize",
  ]);
});

test("stops at the first Clerk error", async () => {
  const { calls, signIn } = fakeSignIn("verifyCode");
  await expect(
    signInTestAccount(signIn, "dev+clerk_test@example.com"),
  ).rejects.toThrow("verifyCode failed");
  expect(calls).not.toContain("finalize");
});
