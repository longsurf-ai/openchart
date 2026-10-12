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

/**
 * Releases a runtime declaration's name once its Provider no longer publishes it.
 * Only the registered declaration itself releases the name; any other is ignored.
 * @example unregister(definition);
 */
export function unregister(definition: DatasetDefinition): void {
  if (definitions.get(definition.name) === definition)
    definitions.delete(definition.name);
}

/** Returns every current declaration in registration order. */
export function list(): DatasetDefinition[] {
  return [...definitions.values()];
}
