// Purpose: Adapt Clerk's prebuilt UI to the shared theme tokens without a second palette.
import type { ClerkProvider } from "@clerk/react";
import type { ComponentProps } from "react";

/** Shared by the host's Clerk provider and every Clerk component, including the sign-in modal. */
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
  elements: {
    // Clerk top-aligns its modal; auto margins center it like the app's
    // dialogs and still let the backdrop scroll when the window is short.
    modalContent: { marginBlock: "auto" },
  },
} satisfies ComponentProps<typeof ClerkProvider>["appearance"];
