// Purpose: Describe a cold stream of source facts independently of persistence and actions.
import type { Stream } from "effect";

/** One source occurrence; condition is stable within that source and time is epoch milliseconds. */
export interface AlertOccurrence<Data> {
  readonly condition: string;
  readonly time: number;
  readonly title: string;
  readonly message: string;
  readonly data: Data;
}

/**
 * The occurrences of one completed evaluation; empty when no condition holds.
 * An element proves the source evaluated successfully even when nothing fires.
 */
export type Evaluation<Data> = ReadonlyArray<AlertOccurrence<Data>>;

/** A source owns its acquisition and cleanup; constructing it starts no work. */
export interface Alertable<Event, E = never, R = never> {
  /**
   * Acquire on consumption and release on completion, failure, or cancellation.
   * Emitted facts contain no action or delivery policy. Errors and dependencies
   * remain visible in the Effect stream type.
   * @example yield* source.observe().pipe(Stream.runForEach(record));
   */
  observe(): Stream.Stream<Event, E, R>;
}
