// Purpose: Failures a Feed client sees without a public reason; never sent over the wire.

import { Schema } from "effect";
import { describeFailure } from "./wording";

/**
 * The caller cancelled the request.
 *
 * @example new Cancelled();
 */
export class Cancelled extends Schema.TaggedError<Cancelled>()(
  "Client.Cancelled",
  {},
) {
  /** The caller chose to stop. */
  get isRetryable(): boolean {
    return false;
  }

  /** The wording sentence, so generic `message` readers never see an empty string. */
  override get message(): string {
    return describeFailure(this);
  }
}

/**
 * The connection to the backend dropped before the request finished.
 *
 * @example new Disconnected();
 */
export class Disconnected extends Schema.TaggedError<Disconnected>()(
  "Client.Disconnected",
  {},
) {
  /** The connection may come back. */
  get isRetryable(): boolean {
    return true;
  }

  /** The wording sentence, so generic `message` readers never see an empty string. */
  override get message(): string {
    return describeFailure(this);
  }
}

/**
 * The backend answered with something the client could not decode.
 *
 * @example new InvalidResponse();
 */
export class InvalidResponse extends Schema.TaggedError<InvalidResponse>()(
  "Client.InvalidResponse",
  {},
) {
  /** The same response would fail again. */
  get isRetryable(): boolean {
    return false;
  }

  /** The wording sentence, so generic `message` readers never see an empty string. */
  override get message(): string {
    return describeFailure(this);
  }
}

/**
 * The backend failed without a public reason, for example a server defect.
 *
 * @example new Internal();
 */
export class Internal extends Schema.TaggedError<Internal>()(
  "Client.Internal",
  {},
) {
  /** Server failures can be transient. */
  get isRetryable(): boolean {
    return true;
  }

  /** The wording sentence, so generic `message` readers never see an empty string. */
  override get message(): string {
    return describeFailure(this);
  }
}
