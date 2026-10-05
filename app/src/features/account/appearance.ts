// Purpose: Adapt Clerk's prebuilt UI to the shared theme tokens without a second palette.
import type { ClerkProvider } from "@clerk/react";
import type { ComponentProps } from "react";

/** Shared by the host's Clerk provider, the account gate's sign-in and account profile. */
export const accountAppearance = {
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorBackground: "var(--popover)",
    colorForeground: "var(--foreground)",
    colorMuted: "var(--muted)",
    colorMutedForeground: "var(--muted-foreground)",
    colorNeutral: "var(--foreground)",
    colorInput: "var(--background)",
    colorInputForeground: "var(--foreground)",
    colorBorder: "var(--border)",
    colorDanger: "var(--destructive)",
    colorRing: "var(--ring)",
    fontFamily: "inherit",
    fontSize: "var(--text-sm)",
    borderRadius: "var(--radius)",
  },
} satisfies ComponentProps<typeof ClerkProvider>["appearance"];
