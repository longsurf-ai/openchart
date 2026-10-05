// Purpose: Give dashboard widgets shared surfaces and a contextual, persistent toolbar.
import type { ReactNode } from "react";

/** Fill the placement with the card itself; contextual controls never reserve space. @example <WidgetCard title="Chart">{children}</WidgetCard> */
export function WidgetCard({
  title,
  children,
  held = false,
}: {
  title: string;
  children: ReactNode;
  held?: boolean;
}) {
  return (
    <section
      aria-label={title}
      data-controls-held={held || undefined}
      className="widget-card relative size-full min-h-0 min-w-0 rounded-lg bg-background"
    >
      {children}
    </section>
  );
}

/** Center controls on the card's top edge without reserving layout space. @example <WidgetControls>{controls}</WidgetControls> */
export function WidgetControls({ children }: { children: ReactNode }) {
  return (
    <div
      className="widget-controls absolute left-1/2 top-0 z-20 flex w-max max-w-[calc(100%-1rem)] -translate-x-1/2 -translate-y-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border bg-background p-1 shadow-sm"
      role="toolbar"
      aria-label="Widget controls"
    >
      {children}
    </div>
  );
}
