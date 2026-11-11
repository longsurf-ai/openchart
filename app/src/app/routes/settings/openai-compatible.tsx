// Purpose: Configure the OpenAI-compatible endpoint, API-key environment, and tier map.
// Uses the shared settings CardItem, Input, Collapsible, and tier map.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { OPENAI_COMPATIBLE } from "@openchart/models/model-tiers";
import { Button } from "@openchart/app/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@openchart/app/components/ui/collapsible/collapsible";
import { Input } from "@openchart/app/components/ui/input";
import { DropdownControl } from "@openchart/app/components/ui/settings/dropdown-control";
import { SecretInput } from "@openchart/app/components/ui/secret-input";
import { CardItem } from "@openchart/app/components/ui/settings/card";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import type { useConfig } from "@openchart/app/hooks/use-config";
import { useNativeProvider } from "./native-provider";

type Draft = {
  baseURL: string;
  catalogProvider: string;
};

function validBaseURL(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Saves endpoint settings that are safe to persist. The API key is stored
 * encrypted by Credential and never returned to the renderer.
 * @example <OpenAiCompatibleSettings transport={transport} settings={settings} />
 */
export function OpenAiCompatibleSettings({
  transport,
  settings,
}: {
  transport: AppTransport;
  settings: ReturnType<typeof useConfig>;
}) {
  const config = settings.config?.models.providers[OPENAI_COMPATIBLE];
  const { discovery } = useNativeProvider(OPENAI_COMPATIBLE, transport);
  const catalog = useQuery({
    queryKey: ["models", "catalog-providers", transport.url],
    queryFn: () => transport.rpc.models.catalogProviders.query(),
    staleTime: Infinity,
    retry: false,
  });
  const catalogOptions = [
    { value: "", name: "Auto (infer from endpoint)" },
    ...(catalog.data ?? []).map((id) => ({ value: id, name: id })),
  ];
  const [open, setOpen] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [keyStatus, setKeyStatus] = useState<
    "idle" | "saved" | "cleared" | "error"
  >("idle");
  const [draft, setDraft] = useState<Draft>({
    baseURL: "",
    catalogProvider: "",
  });
  useEffect(() => {
    if (!config) return;
    setDraft({
      baseURL: config.baseURL,
      catalogProvider: config.catalogProvider,
    });
  }, [config]);
  if (!config) return null;
  const dirty =
    draft.baseURL !== config.baseURL ||
    draft.catalogProvider !== config.catalogProvider;
  const disabled = settings.isSaving || !!settings.readError;
  const urlInvalid =
    draft.baseURL.trim() !== "" && !validBaseURL(draft.baseURL.trim());
  const catalogInvalid = draft.catalogProvider.includes("/");
  const invalid = urlInvalid || catalogInvalid;
  const models =
    discovery.data?.status === "ready" ? discovery.data.provider.models : [];
  const status = discovery.isPending
    ? "Discovering…"
    : discovery.isError
      ? "Discovery failed."
      : discovery.data?.status === "ready"
        ? `${models.length} models discovered`
        : discovery.data?.status === "configuration_required"
          ? discovery.data.message
          : "Not configured.";
  const save = () =>
    settings.update({
      models: {
        providers: {
          [OPENAI_COMPATIBLE]: {
            baseURL: draft.baseURL.trim(),
            catalogProvider: draft.catalogProvider.trim(),
          },
        },
      },
    });
  const saveKey = async () => {
    const key = keyDraft.trim();
    if (!key) return;
    setKeySaving(true);
    try {
      await transport.rpc.models.setApiKey.mutate({ key });
      setKeyDraft("");
      setKeyStatus("saved");
      await discovery.refetch();
    } catch {
      setKeyStatus("error");
    } finally {
      setKeySaving(false);
    }
  };
  const clearKey = async () => {
    setKeySaving(true);
    try {
      await transport.rpc.models.clearApiKey.mutate();
      setKeyDraft("");
      setKeyStatus("cleared");
      await discovery.refetch();
    } catch {
      setKeyStatus("error");
    } finally {
      setKeySaving(false);
    }
  };
  const discover = async () => {
    setDiscovering(true);
    try {
      await transport.rpc.models.refresh.mutate();
      await Promise.all([discovery.refetch(), catalog.refetch()]);
    } finally {
      setDiscovering(false);
    }
  };
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="mt-3 border-t border-border/40 pt-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CollapsibleTrigger
          render={
            <Button size="sm" variant="ghost">
              <ChevronRight
                aria-hidden="true"
                className={`size-4 transition-transform motion-reduce:transition-none ${
                  open ? "rotate-90" : ""
                }`}
              />
              {open ? "Hide settings" : "Configure"}
            </Button>
          }
        />
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{status}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={
              disabled ||
              discovering ||
              discovery.isFetching ||
              dirty ||
              invalid
            }
            onClick={() => void discover()}
          >
            {discovering || discovery.isFetching
              ? "Discovering…"
              : "Discover models"}
          </Button>
        </div>
      </div>
      <CollapsibleContent className="space-y-3 pt-3">
        <CardItem
          title="Endpoint"
          htmlFor="openai-compatible-base-url"
          description="Any OpenAI-compatible /v1 endpoint."
          className="flex-col items-start gap-y-2 sm:flex-row sm:items-center"
          classNameWrapperAction="w-full sm:w-auto"
          actions={
            <Input
              id="openai-compatible-base-url"
              aria-label="OpenAI-compatible base URL"
              placeholder="https://api.openai.com/v1"
              value={draft.baseURL}
              disabled={disabled}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft((current) => ({ ...current, baseURL: value }));
              }}
            />
          }
        />
        <CardItem
          title="API key"
          description="Stored encrypted by OpenChart. The saved key is never shown again."
          className="flex-col items-start gap-y-2 sm:flex-row sm:items-center"
          classNameWrapperAction="w-full sm:w-auto"
          actions={
            <div className="flex w-full items-center gap-2">
              <SecretInput
                aria-label="API key"
                placeholder="sk-…"
                value={keyDraft}
                disabled={disabled || keySaving}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setKeyDraft(value);
                  setKeyStatus("idle");
                }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || keySaving || !keyDraft.trim()}
                onClick={() => void saveKey()}
              >
                Save key
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || keySaving}
                onClick={() => void clearKey()}
              >
                Clear
              </Button>
            </div>
          }
        />
        {keyStatus !== "idle" ? (
          <p
            role="status"
            className={
              keyStatus === "error"
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {keyStatus === "saved"
              ? "API key saved."
              : keyStatus === "cleared"
                ? "API key cleared."
                : "Couldn’t save the API key."}
          </p>
        ) : null}
        <CardItem
          title="Catalog provider override"
          htmlFor="openai-compatible-catalog-provider"
          description="Optional. Auto infers models.dev metadata from the endpoint host, then from a uniquely identified model. Set only when that picks the wrong provider."
          className="flex-col items-start gap-y-2 sm:flex-row sm:items-center"
          classNameWrapperAction="w-full sm:w-auto"
          actions={
            <DropdownControl
              id="openai-compatible-catalog-provider"
              aria-label="Catalog provider"
              value={draft.catalogProvider}
              options={catalogOptions}
              disabled={disabled || catalog.isPending}
              onChange={(value) => {
                setDraft((current) => ({
                  ...current,
                  catalogProvider: String(value),
                }));
              }}
            />
          }
        />
        {invalid ? (
          <p role="alert" className="text-xs text-destructive">
            {urlInvalid
              ? "Enter a valid http(s) URL."
              : "Use a models.dev provider key like deepinfra, not a model ID."}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty || disabled || invalid}
            onClick={save}
          >
            Save endpoint
          </Button>
          {dirty ? (
            <span className="text-xs text-muted-foreground">
              Save before discovering.
            </span>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
