// Purpose: Server-only symbology failures that carry no public Feed reason.
import { Schema } from "effect";

/**
 * The local symbol index could not be read or written. It has no public reason:
 * the boundary reports `internal` and logs the cause.
 *
 * @example persist(effect).pipe(Effect.mapError((cause) => new SymbolIndexUnavailable({ cause })));
 */
export class SymbolIndexUnavailable extends Schema.TaggedError<SymbolIndexUnavailable>()(
  "Symbology.IndexUnavailable",
  { cause: Schema.Defect() },
) {}
