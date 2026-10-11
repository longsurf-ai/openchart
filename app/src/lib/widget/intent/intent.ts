// Purpose: Route typed cross-widget requests to one handler chosen by an explicit resolution policy.

declare const payloadType: unique symbol;

/**
 * What a router does with requests that arrive while the chosen handler is still
 * busy: `each` delivers every request in arrival order; `latest` keeps only the
 * newest waiting request and settles the skipped ones as `superseded`.
 */
export type IntentDelivery = "each" | "latest";

/**
 * A named request one widget raises without knowing which widget answers it,
 * like an FDC3 intent. Intents carry no behavior; `intents.ts` declares each
 * one once so raisers and handlers share a single name and payload type.
 * @example const viewChart = defineIntent<{ listing: ProviderListing }>("ViewChart", { delivery: "latest" });
 */
export interface Intent<Payload> {
  /** Unique key a router uses to match raised requests with registered handlers. */
  readonly name: string;

  /** How requests queue while the chosen handler is busy; see {@link IntentDelivery}. */
  readonly delivery: IntentDelivery;

  /** Type-only payload marker; it has no runtime value. */
  readonly [payloadType]?: Payload;
}

/** The payload an intent carries. @example type Payload = IntentPayload<typeof viewChart>; */
export type IntentPayload<T> =
  T extends Intent<infer Payload> ? Payload : never;

/** Declare an intent's name, payload type and delivery. @example export const viewChart = defineIntent<{ listing: ProviderListing }>("ViewChart", { delivery: "latest" }); */
export function defineIntent<Payload>(
  name: string,
  { delivery }: { delivery: IntentDelivery },
): Intent<Payload> {
  return { name, delivery };
}

/** Who raised a request; absent outside a Dashboard placement. */
export interface IntentSource {
  readonly placementId?: string;
}

/**
 * Applies one request. A handler owns its failure vocabulary: it reports its own
 * errors (usually through a mutation's `errorTitle`) and rejects so the router
 * can settle the request as `failed`.
 */
export type IntentHandler<Payload> = (
  payload: Payload,
  source: IntentSource,
) => void | Promise<void>;

/** How one raised request settled. Raising never rejects; callers that keep state inspect this. */
export type IntentOutcome =
  | { readonly status: "handled"; readonly placementId: string }
  | { readonly status: "unavailable" }
  | { readonly status: "superseded" }
  | { readonly status: "failed"; readonly error: unknown };

/** A placement that can answer an intent; `activatedAt` is 0 until the user first activates it. */
export interface IntentCandidate {
  readonly placementId: string;
  readonly activatedAt: number;
}

/**
 * The resolution policy: choose one candidate, given in registration order, or
 * none. Policies are pure; the router supplies recency and the requester.
 */
export type IntentResolver = (
  candidates: readonly IntentCandidate[],
  source: IntentSource,
) => IntentCandidate | undefined;

/**
 * The default policy, after TradingView's active chart: never the requester
 * itself (as FDC3 channels never echo to their sender), otherwise the most
 * recently activated candidate; ties keep registration order.
 * @example mostRecentlyActive([{ placementId: "wdg_chart", activatedAt: 2 }], { placementId: "wdg_list" });
 */
export const mostRecentlyActive: IntentResolver = (candidates, source) => {
  let chosen: IntentCandidate | undefined;
  for (const candidate of candidates)
    if (
      candidate.placementId !== source.placementId &&
      (!chosen || candidate.activatedAt > chosen.activatedAt)
    )
      chosen = candidate;
  return chosen;
};

/**
 * One scope's intent routing, usually a mounted Dashboard. Handlers register per
 * placement; `raise` resolves a target at call time and queues the request on
 * that handler's lane according to the intent's delivery. Unregistering settles
 * the handler's waiting requests as `unavailable`; a running one finishes.
 */
export interface IntentRouter {
  /**
   * Answer `intent` for a placement until the returned cleanup runs. Throws if
   * that placement already answers it.
   *
   * ```text
   * register(ViewChart, "chart_b", show)
   *   ViewChart: [chart_a]  -->  [chart_a, chart_b]            notifyAll()
   *
   * cleanup()
   *   ViewChart: [chart_a, chart_b]  -->  [chart_a]            notifyAll()
   *   chart_b lane: running request finishes,
   *                 waiting requests settle "unavailable"
   *
   * register(ViewChart, "chart_a", other)  -->  throws: already answers
   * ```
   */
  readonly register: <Payload>(
    intent: Intent<Payload>,
    placementId: string,
    handle: IntentHandler<Payload>,
  ) => () => void;
  /**
   * Record that the user worked in a placement; the resolver prefers recent
   * ones.
   *
   * ```text
   *                    activatedAt
   *                 chart_a   chart_b   notifyAll()
   * start              0         0
   * activate(a)        1         0       yes
   * activate(b)        1         2       yes
   * activate(a)        3         2       yes
   * activate(a)        3         2       no    (already the newest)
   * ```
   */
  readonly activate: (placementId: string) => void;
  /**
   * The placement a request from `source` would reach now, if any. Read-only:
   * it delivers nothing, so callers can use it to show availability.
   *
   * ```text
   * target(ViewChart, { placementId: "chart_a" })
   *
   *   candidates (registration order)      mostRecentlyActive
   *   chart_a  activatedAt 3  --------->   skip: it is the source
   *   chart_b  activatedAt 2  --------->   newest remaining  ==> "chart_b"
   *   chart_c  activatedAt 1  --------->   older
   *
   *   no candidate left  ==> undefined
   * ```
   */
  readonly target: (
    intent: Intent<unknown>,
    source?: IntentSource,
  ) => string | undefined;
  /**
   * Deliver a request; resolves with its outcome and never rejects. The target
   * is chosen at raise time, then the request waits on that handler's lane.
   *
   * ```text
   * raise(ViewChart, { listing }, { placementId: "list" })
   *   |
   *   +-- no target ------------------------------> "unavailable"
   *   |
   *   v
   * chart_b lane      running      waiting
   *   each:           [ r1 ]  <--  [ r2, r3 ]    every request, in order
   *   latest:         [ r1 ]  <--  [ r3 ]        r2 settles "superseded"
   *                     |
   *                     +-- handler resolves -----> "handled" + placementId
   *                     +-- handler rejects ------> "failed" + error
   *
   *   cleanup() while waiting --------------------> "unavailable"
   * ```
   */
  readonly raise: <Payload>(
    intent: Intent<Payload>,
    payload: Payload,
    source?: IntentSource,
  ) => Promise<IntentOutcome>;
  /**
   * Observe registrations and activation for availability; returns cleanup.
   *
   * ```text
   * register()  --+
   * cleanup()   --+-->  listener()  -->  caller re-reads target(...)
   * activate()  --+     (no arguments)
   *
   * raise() and settled requests do not notify.
   * returned cleanup  -->  listener is removed
   * ```
   */
  readonly subscribe: (listener: () => void) => () => void;
}

type Request = {
  readonly payload: unknown;
  readonly source: IntentSource;
  readonly settle: (outcome: IntentOutcome) => void;
};

type Registration = {
  readonly placementId: string;
  readonly handle: IntentHandler<unknown>;
  readonly waiting: Request[];
  running: boolean;
  active: boolean;
};

const unavailable: IntentOutcome = { status: "unavailable" };
const superseded: IntentOutcome = { status: "superseded" };

/**
 * Create a router whose state lives only in memory; discarding it drops pending
 * requests without settling them, so scope it to the owner's lifetime.
 * @example const router = createIntentRouter(); router.register(viewChart, "wdg_chart", show); await router.raise(viewChart, { listing }, { placementId: "wdg_list" });
 */
export function createIntentRouter({
  resolve = mostRecentlyActive,
}: { resolve?: IntentResolver } = {}): IntentRouter {
  const registrations = new Map<string, Registration[]>();
  const activations = new Map<string, number>();
  const listeners = new Set<() => void>();
  let clock = 0;
  const notifyAll = () => listeners.forEach((listener) => listener());

  const choose = (intent: Intent<unknown>, source: IntentSource) => {
    const answering = registrations.get(intent.name) ?? [];
    const chosen = resolve(
      answering.map(({ placementId }) => ({
        placementId,
        activatedAt: activations.get(placementId) ?? 0,
      })),
      source,
    );
    return answering.find(
      (registration) => registration.placementId === chosen?.placementId,
    );
  };

  const drain = async (registration: Registration) => {
    registration.running = true;
    for (
      let request = registration.waiting.shift();
      request;
      request = registration.waiting.shift()
    ) {
      try {
        await registration.handle(request.payload, request.source);
        request.settle({
          status: "handled",
          placementId: registration.placementId,
        });
      } catch (error) {
        request.settle({ status: "failed", error });
      }
    }
    registration.running = false;
  };

  return {
    register: (intent, placementId, handle) => {
      const answering = registrations.get(intent.name) ?? [];
      if (answering.some((item) => item.placementId === placementId))
        throw new Error(
          `${placementId} already answers the ${intent.name} intent.`,
        );
      const registration: Registration = {
        placementId,
        handle: handle as IntentHandler<unknown>,
        waiting: [],
        running: false,
        active: true,
      };
      registrations.set(intent.name, [...answering, registration]);
      notifyAll();
      return () => {
        if (!registration.active) return;
        registration.active = false;
        registrations.set(
          intent.name,
          (registrations.get(intent.name) ?? []).filter(
            (item) => item !== registration,
          ),
        );
        for (const request of registration.waiting.splice(0))
          request.settle(unavailable);
        notifyAll();
      };
    },
    activate: (placementId) => {
      if (activations.get(placementId) === clock && clock > 0) return;
      activations.set(placementId, ++clock);
      notifyAll();
    },
    target: (intent, source = {}) => choose(intent, source)?.placementId,
    raise: (intent, payload, source = {}) => {
      const registration = choose(intent, source);
      if (!registration) return Promise.resolve(unavailable);
      return new Promise<IntentOutcome>((settle) => {
        if (intent.delivery === "latest")
          for (const skipped of registration.waiting.splice(0))
            skipped.settle(superseded);
        registration.waiting.push({ payload, source, settle });
        if (!registration.running) void drain(registration);
      });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
