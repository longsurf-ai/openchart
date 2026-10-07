// Purpose: Open Clerk's sign-in modal from any surface that needs an account.
import { useClerk } from "@clerk/react";

import { Button, type ButtonProps } from "@openchart/app/components/ui/button";

/**
 * Opens Clerk's centered sign-in modal; Clerk owns the flow and closes it.
 * `AccountConnectionProvider` then hands the new session's Cloud key to the
 * local account in the background. Accepts shared Button styling props.
 * @example <SignInButton className="mt-4" />
 */
export function SignInButton(props: Omit<ButtonProps, "onClick" | "children">) {
  const clerk = useClerk();
  return (
    <Button size="sm" {...props} onClick={() => clerk.openSignIn()}>
      Sign in
    </Button>
  );
}
