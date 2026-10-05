// Purpose: Configure Clerk's renderer provider for the shared desktop app.
import { ClerkProvider, useAuth, useSignIn } from "@clerk/electron/react";
import { accountAppearance } from "@openchart/app/features/account/appearance";
import { useEffect, useRef, type PropsWithChildren } from "react";

import { signInTestAccount } from "./test-account";

/**
 * Signs the shared development test user in once per window, without UI, so
 * the account gate continues with the usual key handoff. Failures are logged
 * and leave the normal sign-in visible.
 */
function TestAccountSignIn({ email }: { email: string }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { signIn } = useSignIn();
  const started = useRef(false);
  useEffect(() => {
    // Once per window: signing out keeps the gate available for manual testing.
    if (!isLoaded || isSignedIn || started.current) return;
    started.current = true;
    signInTestAccount(signIn, email).catch((error: unknown) => {
      console.error(`Couldn’t sign in test account ${email}`, error);
    });
  }, [email, isLoaded, isSignedIn, signIn]);
  return null;
}

/**
 * Creates the required desktop account provider for one application mount.
 * Clerk owns its session lifecycle; the host has already parsed its key. A
 * `testAccount`, supplied only by development builds, signs that user in.
 * @example bootstrap(connection, createClerkProvider(publishableKey), host);
 */
export function createClerkProvider(
  publishableKey: string,
  testAccount?: string,
) {
  return ({ children }: PropsWithChildren) => (
    <ClerkProvider
      publishableKey={publishableKey}
      allowedRedirectProtocols={["openchart:", "openchart-dev:"]}
      // Sign-in renders inside the account gate; Clerk never navigates the app.
      routerPush={() => {}}
      routerReplace={() => {}}
      appearance={accountAppearance}
    >
      {testAccount ? <TestAccountSignIn email={testAccount} /> : null}
      {children}
    </ClerkProvider>
  );
}
