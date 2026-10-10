import {
  InvalidReply as QuestionInvalidReply,
  NotFoundError as QuestionNotFound,
} from "@openchart/server/agent/question/errors";
// Purpose: Own the server's public error policy, domain mappings, and reporting of unexpected failures.
import { SetupFailed } from "@openchart/server/models/onboarding/errors";
import { AlertSaveConflict } from "@openchart/server/alert/errors";

import {
  EntryMissing,
  EntryStale,
  WorkspaceClosed,
  WorkspaceFileProtected,
  WorkspaceMissing,
  WorkspaceMediaTooLarge,
  WorkspacePathInvalid,
  WorkspaceReadFailed,
  WorkspaceUnknown,
  WorkspaceWriteFailed,
} from "@openchart/server/workspace/errors";
import { FeedError, type FeedReason } from "@openchart/feed";
import * as Tea from "@openchart/tea";
import { StoreNotFound } from "@openchart/server/agent/errors";
import {
  BranchUnavailable,
  SessionBusy,
  TruncateUnavailable,
} from "@openchart/server/agent/session/errors";
import {
  InvalidCommandInput,
  UnknownCommand,
  UnsupportedCommandPart,
} from "@openchart/server/agent/command/errors";

import { Auth } from "@openchart/server/access/auth";
import { Billing } from "@openchart/server/access/billing";
import { Credential } from "@openchart/server/access/credential";
import { Integration } from "@openchart/server/access/integration";
import {
  ConfigInvalid,
  ConfigReadFailed,
  ConfigReadOnly,
  ConfigWriteFailed,
} from "@openchart/server/config/errors";
import {
  ConfigurationUnavailable,
  ModelNotFound,
  ProviderInit,
  QuotaUnavailable,
} from "@openchart/server/models/errors";
import {
  PatchRejected,
  ResourceNotFound,
  ResourceStateInvalid,
  RevisionConflict,
} from "@openchart/server/lib/resource/errors";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server";
import { Schema } from "effect";

/**
 * Public domain details; transport adapters forward these without interpreting
 * them. `error` is the encoded public error (a FeedError or a Tea.Failure):
 * tRPC sends it at `data.error` and Hose as the `failed` body. Domains not yet
 * migrated keep their own fields.
 */
type Details = {
  error: typeof FeedError.Encoded | Tea.Failure | null;
  entryStale: Pick<EntryStale, "workspaceId" | "path" | "current"> | null;
  resourceStateInvalid: Pick<
    ResourceStateInvalid,
    "resource" | "issues"
  > | null;
};

/**
 * Safe server failure description shared by HTTP and channel adapters.
 * Status uses tRPC's existing HTTP error vocabulary. `code` is a label for
 * logs and agent tool results; neither transport sends it, so consumers decode
 * `details.error` instead. Hose maps status BAD_REQUEST to `invalid_request`
 * when there is no public error. Causes remain local.
 */
export type Failure = {
  code: string;
  message: string;
  status: TRPC_ERROR_CODE_KEY;
  details: Details;
};

/** A transport parser rejected caller input before invoking application code. */
export class InvalidRequest extends Error {
  /**
   * Retains parser diagnostics locally while exposing a fixed public message.
   * @example
   * throw new InvalidRequest(parsed.error);
   */
  constructor(cause: unknown) {
    super("Invalid request", { cause });
  }
}

const encodeFeedError = Schema.encodeSync(FeedError);

const feedStatus: Record<FeedReason["_tag"], TRPC_ERROR_CODE_KEY> = {
  "Feed.InvalidRequest": "BAD_REQUEST",
  "Feed.Unsupported": "BAD_REQUEST",
  "Feed.HistoryUnavailable": "BAD_REQUEST",
  "Feed.NotFound": "NOT_FOUND",
  "Feed.AccessDenied": "FORBIDDEN",
  "Feed.RateLimited": "TOO_MANY_REQUESTS",
  "Feed.SourceUnavailable": "SERVICE_UNAVAILABLE",
  "Feed.InvalidSourceData": "BAD_GATEWAY",
  "Feed.IncompleteData": "BAD_GATEWAY",
  "Feed.ResyncRequired": "CONFLICT",
  "Feed.Reconfigured": "CONFLICT",
};

const teaStatus: Record<Tea.Failure["code"], TRPC_ERROR_CODE_KEY> = {
  compile_failed: "BAD_REQUEST",
  invalid_request: "BAD_REQUEST",
  node_unavailable: "NOT_FOUND",
  invalid_data: "BAD_GATEWAY",
  upstream: "BAD_GATEWAY",
  cancelled: "CLIENT_CLOSED_REQUEST",
  internal: "INTERNAL_SERVER_ERROR",
};

const billingFailures = {
  "referral-invalid": ["BAD_REQUEST", "This invitation code is invalid."],
  "referral-used": [
    "CONFLICT",
    "This invitation code has already been redeemed.",
  ],
  "referral-already-redeemed": [
    "CONFLICT",
    "You have already redeemed an invitation code.",
  ],
  "referral-self": [
    "BAD_REQUEST",
    "You cannot redeem your own invitation code.",
  ],
  "subscription-required": [
    "CONFLICT",
    "Subscribe to create invitation codes.",
  ],
  "not-configured": ["SERVICE_UNAVAILABLE", "Billing is not configured."],
  "missing-credential": ["UNAUTHORIZED", "Sign in to use billing."],
  "credential-changed": ["CONFLICT", "Your account changed. Please try again."],
  "invalid-credential": ["UNAUTHORIZED", "Sign in again to use billing."],
  unauthorized: [
    "UNAUTHORIZED",
    "Your account credential was rejected. Please sign in again.",
  ],
  network: ["BAD_GATEWAY", "Could not reach billing. Please try again."],
  timeout: [
    "GATEWAY_TIMEOUT",
    "Billing timed out. Please refresh before trying again.",
  ],
  provider: [
    "BAD_GATEWAY",
    "Billing is temporarily unavailable. Please try again.",
  ],
  "invalid-response": [
    "BAD_GATEWAY",
    "Billing returned an invalid response. Please try again.",
  ],
  "invalid-plan": ["BAD_REQUEST", "This plan is unavailable."],
  "already-subscribed": [
    "CONFLICT",
    "You already have a subscription. Use Manage subscription.",
  ],
  "customer-not-found": [
    "NOT_FOUND",
    "No billing account exists yet. Start a subscription first.",
  ],
  "checkout-in-progress": [
    "CONFLICT",
    "Checkout is in progress. Please wait and refresh.",
  ],
  "checkout-changed": [
    "CONFLICT",
    "Checkout changed. Please refresh before trying again.",
  ],
  "billing-state-invalid": [
    "CONFLICT",
    "Your billing state needs attention. Please contact support.",
  ],
  "configuration-invalid": [
    "SERVICE_UNAVAILABLE",
    "Billing configuration is unavailable.",
  ],
  "rate-limited": [
    "TOO_MANY_REQUESTS",
    "Too many billing requests. Please wait and try again.",
  ],
  "invalid-request": ["BAD_REQUEST", "The billing request is invalid."],
} satisfies Record<
  Billing.OperationFailed["reason"],
  [TRPC_ERROR_CODE_KEY, string]
>;

const serverStatuses = new Set<TRPC_ERROR_CODE_KEY>([
  "INTERNAL_SERVER_ERROR",
  "NOT_IMPLEMENTED",
  "BAD_GATEWAY",
  "SERVICE_UNAVAILABLE",
  "GATEWAY_TIMEOUT",
]);

function failure(
  status: TRPC_ERROR_CODE_KEY,
  code: string,
  message: string,
  details: Partial<Details> = {},
): Failure {
  return {
    status,
    code,
    message,
    details: {
      error: null,
      entryStale: null,
      resourceStateInvalid: null,
      ...details,
    },
  };
}

/**
 * Classifies a failure once at a server boundary. Only known domain types may
 * publish their messages/details. Unknown server failures are reported here
 * and receive a fixed public message. Native protocol failures retain their
 * status with a generic message. Never call this from Providers or format twice.
 *
 * @param fallback - Status already established by a transport, otherwise 500.
 * @example
 * const error = failureFor(new FeedError({ reason: new FeedReasons.NotFound({ provider }) }));
 * // error.status === 'NOT_FOUND'; error.details.error is the encoded FeedError
 */
export function failureFor(
  cause: unknown,
  fallback: TRPC_ERROR_CODE_KEY = "INTERNAL_SERVER_ERROR",
): Failure {
  if (cause instanceof UnknownCommand)
    return failure(
      "NOT_FOUND",
      "command.unknown",
      `Unknown command: /${cause.name}`,
    );
  if (cause instanceof InvalidCommandInput)
    return failure(
      "BAD_REQUEST",
      "command.invalid_input",
      `Invalid /${cause.name} arguments: ${cause.detail}`,
    );
  if (cause instanceof UnsupportedCommandPart)
    return failure(
      "BAD_REQUEST",
      "command.unsupported_part",
      "This Part cannot be restored to a command without losing information.",
    );
  if (cause instanceof EntryStale)
    return failure(
      "CONFLICT",
      "workspace.entry_stale",
      "The file has changed. Read it again before saving.",
      {
        entryStale: {
          workspaceId: cause.workspaceId,
          path: cause.path,
          current: cause.current,
        },
      },
    );
  if (
    cause instanceof WorkspaceUnknown ||
    cause instanceof WorkspaceMissing ||
    cause instanceof EntryMissing
  )
    return failure(
      "NOT_FOUND",
      "workspace.missing",
      "The workspace or file does not exist.",
    );
  if (cause instanceof WorkspaceClosed)
    return failure(
      "CONFLICT",
      "workspace.closed",
      "The workspace has been closed.",
    );
  if (cause instanceof WorkspaceMediaTooLarge)
    return failure(
      "BAD_REQUEST",
      "workspace.media_too_large",
      `Workspace media exceeds the ${cause.maxBytes / (1024 * 1024)} MiB limit.`,
    );
  if (cause instanceof WorkspaceFileProtected)
    return failure(
      "FORBIDDEN",
      "workspace.protected_file",
      "Built-in indicator scripts are read-only. Duplicate an indicator to customize it.",
    );
  if (cause instanceof WorkspacePathInvalid)
    return failure(
      "BAD_REQUEST",
      "workspace.invalid_path",
      "The artifact path must stay inside its workspace without symbolic links.",
    );
  if (
    cause instanceof WorkspaceReadFailed ||
    cause instanceof WorkspaceWriteFailed
  )
    return failure(
      "INTERNAL_SERVER_ERROR",
      "workspace.io_failed",
      "Unable to access the workspace file.",
    );
  if (cause instanceof FeedError) {
    // The server-only cause (DatasetError, upstream response) is logged once here, never encoded.
    console.warn("Feed request failed", cause);
    return failure(
      feedStatus[cause.reason._tag],
      cause.reason._tag,
      cause.message,
      { error: encodeFeedError(cause) },
    );
  }
  if (cause instanceof Tea.Error) {
    return failure(teaStatus[cause.code], `tea.${cause.code}`, cause.message, {
      error: { code: cause.code, message: cause.message },
    });
  }
  if (cause instanceof ResourceNotFound) {
    return failure(
      "NOT_FOUND",
      "resource.not_found",
      `${cause.resource} ${cause.id} not found`,
    );
  }
  if (cause instanceof RevisionConflict) {
    return failure(
      "CONFLICT",
      "resource.revision_conflict",
      `${cause.resource} ${cause.id} is at revision ${cause.actual}, expected ${cause.expected}`,
    );
  }
  if (cause instanceof AlertSaveConflict) {
    return failure(
      "CONFLICT",
      "alert.save_conflict",
      "This alert's actions changed. Reload the alert before saving.",
    );
  }
  if (cause instanceof PatchRejected) {
    return failure(
      "BAD_REQUEST",
      "resource.patch_rejected",
      `patch op ${cause.index} (${cause.op} ${cause.path}) failed: ${cause.reason}`,
    );
  }
  if (cause instanceof ResourceStateInvalid) {
    return failure(
      "BAD_REQUEST",
      "resource.state_invalid",
      `${cause.resource} state is invalid: ${cause.reason}`,
      {
        resourceStateInvalid: {
          resource: cause.resource,
          issues: cause.issues,
        },
      },
    );
  }
  if (cause instanceof InvalidRequest) {
    return failure("BAD_REQUEST", "invalid_request", cause.message);
  }
  if (cause instanceof QuestionNotFound)
    return failure(
      "NOT_FOUND",
      cause._tag,
      "This question is no longer waiting for an answer.",
    );
  if (cause instanceof QuestionInvalidReply)
    return failure("BAD_REQUEST", cause._tag, cause.message);
  if (cause instanceof StoreNotFound)
    return failure(
      "NOT_FOUND",
      "agent.not_found",
      "The conversation or message no longer exists.",
    );
  if (cause instanceof BranchUnavailable)
    return failure(
      "BAD_REQUEST",
      "agent.branch_unavailable",
      "Choose a completed reply outside a Dig In to start a new conversation.",
    );
  if (cause instanceof SessionBusy)
    return failure(
      "CONFLICT",
      "agent.session_busy",
      "Wait for the conversation's queued and running work to finish before changing its history.",
    );
  if (cause instanceof TruncateUnavailable)
    return failure(
      "BAD_REQUEST",
      "agent.truncate_unavailable",
      "Choose a main conversation and a completed assistant reply, or clear its history.",
    );
  if (cause instanceof ConfigInvalid)
    return failure(
      "BAD_REQUEST",
      "config.invalid",
      "The settings change contains invalid values.",
    );
  if (cause instanceof ConfigReadFailed)
    return failure(
      "SERVICE_UNAVAILABLE",
      "config.read_failed",
      "Settings could not be read. Check settings.json and try again.",
    );
  if (cause instanceof ConfigWriteFailed)
    return failure(
      "INTERNAL_SERVER_ERROR",
      "config.write_failed",
      "Settings could not be saved.",
    );
  if (cause instanceof ConfigReadOnly)
    return failure(
      "FORBIDDEN",
      "config.read_only",
      "This backend uses a read-only configuration source.",
    );
  if (cause instanceof ConfigurationUnavailable)
    return failure(
      "SERVICE_UNAVAILABLE",
      "models.configuration",
      "Model settings are invalid or unavailable.",
    );
  if (cause instanceof SetupFailed)
    return failure("CONFLICT", "models.setup", cause.message);
  if (cause instanceof ProviderInit)
    return failure(
      "SERVICE_UNAVAILABLE",
      "models.provider",
      "The model provider could not be initialized. Check its configuration and credentials.",
    );
  if (cause instanceof ModelNotFound)
    return failure(
      "NOT_FOUND",
      "models.not_found",
      "The selected model is not available.",
    );
  if (cause instanceof QuotaUnavailable)
    return failure(
      "SERVICE_UNAVAILABLE",
      "models.quota",
      "Plan usage could not be read. Try again.",
    );
  if (cause instanceof Billing.OperationFailed) {
    const [status, message] = billingFailures[cause.reason];
    return failure(status, `billing.${cause.reason}`, message);
  }
  if (cause instanceof Auth.AuthOperationFailed) {
    const messages = {
      storage: "Could not access protected account storage.",
      busy: "An account operation is already in progress.",
      closed: "Account sign in is not configured.",
      "credential-mismatch":
        "The saved account key no longer matches. Please restart sign in.",
    };
    return failure(
      cause.reason === "busy" || cause.reason === "credential-mismatch"
        ? "CONFLICT"
        : "BAD_REQUEST",
      `auth.${cause.reason}`,
      messages[cause.reason],
    );
  }
  if (cause instanceof Auth.SessionUnavailable)
    return failure(
      "SERVICE_UNAVAILABLE",
      "auth.unavailable",
      "Account state is unavailable. Please try again.",
    );
  if (cause instanceof Credential.StorageFailed)
    return failure(
      "INTERNAL_SERVER_ERROR",
      "credential.storage",
      "Could not access protected credential storage.",
    );
  if (cause instanceof Integration.CodeRequiredError) {
    return failure(
      "BAD_REQUEST",
      "integration.code_required",
      "Authorization code is required",
    );
  }
  if (cause instanceof Integration.AuthorizationError) {
    return failure(
      "BAD_REQUEST",
      "integration.authorization",
      "Authorization failed",
    );
  }
  if (serverStatuses.has(fallback)) {
    console.error("Server request failed", cause);
    return failure(fallback, "internal", "Internal server error");
  }
  return failure(
    fallback,
    fallback.toLowerCase(),
    fallback === "BAD_REQUEST"
      ? "Invalid request"
      : fallback.replaceAll("_", " ").toLowerCase(),
  );
}
