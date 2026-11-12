// Purpose: Lists the providers OpenChart ships; the only module that names more than one.
import {
  ANTIGRAVITY,
  CLAUDE_CODE,
  CODEX,
  GROK,
  OPENAI_COMPATIBLE,
  type ApiProviderID,
  type NativeProviderID,
} from "@openchart/models/model-tiers";
import type { ApiProvider } from "@openchart/models/api-provider";
import type { NativeProvider } from "@openchart/models/native-provider";
import { antigravity } from "./antigravity/binding";
import { claudeCode } from "./claude-code/binding";
import { codex } from "./codex/binding";
import { grok } from "./grok/binding";
import { openaiCompatible } from "./openai-compatible/binding";

/** Every supported native CLI provider by ID; hosts construct bindings from here. */
export const NATIVE_PROVIDERS: Readonly<
  Partial<Record<NativeProviderID, NativeProvider>>
> = {
  [CLAUDE_CODE]: claudeCode,
  [CODEX]: codex,
  [ANTIGRAVITY]: antigravity,
  [GROK]: grok,
};

/** Every supported plain HTTP provider by ID; these use the ordinary AI SDK path. */
export const API_PROVIDERS: Readonly<Record<ApiProviderID, ApiProvider>> = {
  [OPENAI_COMPATIBLE]: openaiCompatible,
};

/**
 * Looks up the native provider behind a model; plain AI SDK providers have none.
 * @example
 * const provider = nativeProvider(model.providerID);
 * if (provider) options = provider.requestOptions(context);
 */
export function nativeProvider(providerID: string): NativeProvider | undefined {
  if (!Object.hasOwn(NATIVE_PROVIDERS, providerID)) return undefined;
  return NATIVE_PROVIDERS[providerID as NativeProviderID];
}
