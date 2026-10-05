// Purpose: Runtime registry for uniquely named Dataset declarations.

import type { DatasetDefinition } from "./definition";

/** The one process-wide source of truth for declared Dataset names. */
const definitions = new Map<string, DatasetDefinition>();

/**
 * Adds one declaration to the process-wide Dataset registry.
 *
 * @throws If another declaration already owns the same name.
 */
export function register(definition: DatasetDefinition): void {
  if (definitions.has(definition.name)) {
    throw new Error(`Dataset "${definition.name}" is already declared`);
  }
  definitions.set(definition.name, definition);
}

/** Returns every declaration in registration order. */
export function list(): DatasetDefinition[] {
  return [...definitions.values()];
}
