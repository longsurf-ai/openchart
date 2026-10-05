// Purpose: Defines credential storage failures without exposing secret material.

import { Schema } from "effect";

/**
 * Credential storage could not safely read, write, or remove a credential.
 * Includes SQL, encryption, and value codec failures; carries no credential
 * values, raw storage contents, or underlying error messages.
 * @example
 * const error = new StorageFailed({});
 */
export class StorageFailed extends Schema.TaggedError<StorageFailed>()(
  "Credential.StorageFailed",
  {},
) {}
