// Purpose: Gives model tests their shared application event stream.
import { Events } from "@openchart/server/events";
import { Credential } from "@openchart/server/access/credential";
import { Effect, Layer } from "effect";
import { vi } from "vitest";
import type { AvailableModel } from "@openchart/models/model-provider";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { Models } from "./models";
/** In-memory provider keys; native model tests never touch encrypted storage. */
export const modelKeys = new Map<string, string>();
const credentials = {
  list: (integrationID: string, active?: boolean) =>
    Effect.succeed(
      active && modelKeys.has(integrationID)
        ? [
            {
              id: "cred_test",
              integrationID,
              label: "default",
              active: true,
              value: { type: "key", key: modelKeys.get(integrationID)! },
            },
          ]
        : [],
    ),
  create: (input: { integrationID: string; value: { key: string } }) => {
    modelKeys.set(input.integrationID, input.value.key);
    return Effect.succeed({});
  },
  clear: (integrationID: string) => {
    modelKeys.delete(integrationID);
    return Effect.void;
  },
} as unknown as Credential.Interface;
/** Native model tests share events and a tiny in-memory credential service. */
export const modelTestDependencies = Layer.merge(
  Events.layer,
  Layer.succeed(Credential.Service, credentials),
);

/** Unused setup methods for consumers that only exercise inference. */
export const unusedModelSetup: Pick<
  Models.Interface,
  | "discover"
  | "quota"
  | "refresh"
  | "catalogProviders"
  | "setup"
  | "setApiKey"
  | "clearApiKey"
> = {
  discover: () => Effect.die("Unexpected discovery"),
  quota: () => Effect.die("Unexpected quota"),
  refresh: () => Effect.die("Unexpected refresh"),
  catalogProviders: () => Effect.die("Unexpected catalog read"),
  setApiKey: () => Effect.die("Unexpected key write"),
  clearApiKey: () => Effect.die("Unexpected key clear"),
  setup: {
    state: () => Effect.die("Unexpected setup"),
    start: () => Effect.die("Unexpected setup"),
    write: () => Effect.die("Unexpected setup"),
    cancel: () => Effect.die("Unexpected setup"),
  },
};

/** Supplies an inference fixture at the public Models boundary; no native runtime starts.
 * @example const fixture = mockModels(model, language);
 */
export function mockModels(model: AvailableModel, language: LanguageModelV4) {
  const service = {
    ...unusedModelSetup,
    list: vi.fn<Models.Interface["list"]>(() =>
      Effect.succeed([{ id: model.providerID, name: "Test", models: [model] }]),
    ),
    getModel: vi.fn<Models.Interface["getModel"]>(() => Effect.succeed(model)),
    getLanguage: vi.fn<Models.Interface["getLanguage"]>(() =>
      Effect.succeed(language),
    ),
  } satisfies Models.Interface;
  const create = vi.fn(() => service);
  const dispose = vi.fn(async () => {});
  vi.spyOn(Models, "layer").mockImplementation(() =>
    Layer.effect(
      Models.Service,
      Effect.acquireRelease(Effect.sync(create), () => Effect.promise(dispose)),
    ),
  );
  return { service, create, dispose };
}
