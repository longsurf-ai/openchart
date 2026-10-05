// Purpose: Sign the shared development test user in through Clerk's test mode without UI.
import type { useSignIn } from "@clerk/electron/react";

type SignIn = Pick<
  ReturnType<typeof useSignIn>["signIn"],
  "create" | "emailCode" | "finalize"
>;

/** Clerk test mode accepts this code for `+clerk_test` addresses instead of sending email. */
const testCode = "424242";

/**
 * Signs `email` in with Clerk's fixed test code and activates the session.
 * Stops at the first failed step and throws its Clerk error; production
 * instances keep test mode off, so the code is rejected there.
 * @example await signInTestAccount(signIn, "dev+clerk_test@example.com");
 */
export async function signInTestAccount(signIn: SignIn, email: string) {
  for (const step of [
    () => signIn.create({ identifier: email }),
    () => signIn.emailCode.sendCode(),
    () => signIn.emailCode.verifyCode({ code: testCode }),
    () => signIn.finalize(),
  ]) {
    const { error } = await step();
    if (error) throw error;
  }
}
