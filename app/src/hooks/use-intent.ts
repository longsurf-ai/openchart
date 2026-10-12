// Purpose: Raise, answer and activate intents from widgets through the nearest router.
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import type {
  Intent,
  IntentHandler,
  IntentOutcome,
} from "@openchart/app/lib/widget/intent/intent";
import { IntentRouterContext } from "@openchart/app/lib/widget/intent/provider";
import { WidgetContext } from "@openchart/app/lib/widget/widget";

const unavailable: IntentOutcome = { status: "unavailable" };
const unsubscribed = () => () => {};

/**
 * Raise an intent as the containing placement. `available` re-renders when a
 * handler starts or stops answering, so sources can offer the action only when
 * it would land. `raise` resolves with the outcome and never rejects; handlers
 * report their own failures. Without a router it stays unavailable.
 * @example const chart = useIntent(viewChart); if (chart.available) void chart.raise({ listing });
 */
export function useIntent<Payload>(intent: Intent<Payload>) {
  const router = useContext(IntentRouterContext);
  const placementId = useContext(WidgetContext)?.placementId;
  const available = useSyncExternalStore(
    router?.subscribe ?? unsubscribed,
    () => router?.target(intent, { placementId }) !== undefined,
  );
  const raise = useCallback(
    (payload: Payload) =>
      router
        ? router.raise(intent, payload, { placementId })
        : Promise.resolve(unavailable),
    [router, intent, placementId],
  );
  return { available, raise };
}

/**
 * Answer an intent for the containing placement while mounted and `handle` is
 * defined; pass undefined while the widget cannot answer. The latest `handle`
 * runs without re-registering. Unmounting settles waiting requests as
 * `unavailable`. Registers nothing outside a router or placement.
 * @example useIntentHandler(viewChart, chartId ? show : undefined);
 */
export function useIntentHandler<Payload>(
  intent: Intent<Payload>,
  handle: IntentHandler<Payload> | undefined,
) {
  const router = useContext(IntentRouterContext);
  const placementId = useContext(WidgetContext)?.placementId;
  const latest = useRef(handle);
  latest.current = handle;
  const answering = handle !== undefined;
  useEffect(() => {
    if (!router || !placementId || !answering) return;
    return router.register(intent, placementId, (payload, source) => {
      if (!latest.current)
        throw new Error(`This widget no longer answers ${intent.name}.`);
      return latest.current(payload, source);
    });
  }, [router, placementId, intent, answering]);
}

/**
 * Return a stable callback that marks a placement as the one the user is
 * working in, so resolvers prefer it. A no-op without a router.
 * @example const activate = useIntentActivation(placementId); <section onPointerDownCapture={activate} />
 */
export function useIntentActivation(placementId: string) {
  const router = useContext(IntentRouterContext);
  return useCallback(
    () => router?.activate(placementId),
    [router, placementId],
  );
}
