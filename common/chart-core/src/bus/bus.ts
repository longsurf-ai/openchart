// Purpose: Global typed publish/subscribe event bus with Zod schema validation
// Module:  @openchart/chart-core / bus

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";

export namespace Bus {
  type Handler<T> = (event: T) => void;
  type Unsubscribe = () => void;

  const listeners = new Map<string, Set<Handler<unknown>>>();

  export function subscribe<T>(
    event: { type: string },
    handler: Handler<T>,
  ): Unsubscribe {
    const handlers = listeners.get(event.type) ?? new Set();
    handlers.add(handler as Handler<unknown>);
    listeners.set(event.type, handlers);

    return () => {
      handlers.delete(handler as Handler<unknown>);
      if (handlers.size === 0) {
        listeners.delete(event.type);
      }
    };
  }

  export function publish<T>(
    event: { type: string; schema: z.ZodType<T> },
    data: T,
  ): void {
    const handlers = listeners.get(event.type);
    if (!handlers) return;

    const parsed = event.schema.parse(data);
    for (const handler of handlers) {
      handler(parsed);
    }
  }

  export function clear(): void {
    listeners.clear();
  }
}

export namespace BusEvent {
  export function define<T>(type: string, schema: z.ZodType<T>) {
    return { type, schema };
  }
}
