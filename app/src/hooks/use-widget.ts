// Purpose: Read a placement's identity and keep portaled widget controls visible.
import { useContext, useEffect } from "react";

import { WidgetContext } from "@openchart/app/lib/widget/widget";

/** Read the containing widget. @example const { transport } = useWidget(); */
export function useWidget() {
  const widget = useContext(WidgetContext);
  if (!widget) throw new Error("Widget components require WidgetContext.");
  return widget;
}

/** Hold the card toolbar while a menu or dialog is open; standalone controls need no lease. @example useWidgetControls(open); */
export function useWidgetControls(open: boolean) {
  const hold = useContext(WidgetContext)?.holdControls;
  useEffect(() => (open ? hold?.() : undefined), [open, hold]);
}
