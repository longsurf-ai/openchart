import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
import {
  ClientFailures,
  describeFailure,
  providerName,
  type SymbolIndexState,
} from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { offersRetry } from "@openchart/app/lib/feed/transport";
// Purpose: Configure providers and index native listings using the existing settings cards.
import { useOutletContext } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import type { SymbolIndexRequest } from "@openchart/feed";
import type { AppRouteContext } from "@openchart/app/app/route-context";
import { Button } from "@openchart/app/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@openchart/app/components/ui/collapsible/collapsible";
import { Card } from "@openchart/app/components/ui/settings/card";
import { useConfig } from "@openchart/app/hooks/use-config";
import { useSymbologyFeed } from "@openchart/app/hooks/use-datafeed";
import { resourceQueryKeys } from "@openchart/app/lib/resource/invalidation";
import { SettingsPage } from "./settings-page";
import { ProviderAccessControl } from "./provider-access";

/** Provider configuration and saved-listing coverage stay visible independently of availability. @example <ProviderSettings /> */
export default function ProviderSettings() {
  const { transport } = useOutletContext<AppRouteContext>();
  const settings = useConfig(transport);
  const symbology = useSymbologyFeed();
  const queryClient = useQueryClient();
  const statusKey = ["symbology", "indexStatus"] as const;
  // The Feed client decodes failed jobs into reasons that carry isRetryable.
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => symbology.indexStatus(),
    refetchInterval: 1000,
  });
  const counts = useQuery({
    queryKey: [...resourceQueryKeys.resource("symbology"), "counts"],
    queryFn: () => transport.rpc.resources.symbology.counts.query(),
  });
  const index = useMutation({
    mutationFn: (request: SymbolIndexRequest) => symbology.index(request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKey }),
  });
  return (
    <SettingsPage title="Data Providers" settings={settings}>
      {settings.config ? (
        <Card title="Data Providers">
          {counts.error ? (
            <div className="mb-3">
              <Button variant="link" onClick={() => void counts.refetch()}>
                Retry indexed counts
              </Button>
            </div>
          ) : null}
          {status.error ? (
            <div className="mb-3">
              <Button variant="link" onClick={() => void status.refetch()}>
                Retry index status
              </Button>
            </div>
          ) : null}
          {(["openchart", "binance", "yfinance"] as const).map((id) => {
            const name = providerName(ProviderId.make(id));
            const provider = status.data?.find((row) => row.providerId === id);
            const job = provider?.job;
            const running = job?.state === "running";
            const count =
              counts.data?.find((row) => row.provider === id)?.count ?? 0;
            const reason = !provider
              ? "Waiting for provider status."
              : !provider.indexable
                ? "Full indexing is unavailable for this provider. Search results are saved automatically."
                : !provider.available
                  ? "Enable this provider and wait for it to become available."
                  : undefined;
            return (
              <Collapsible
                key={id}
                className="border-b border-border/40 py-3 first:pt-0 last:border-none last:pb-0"
              >
                <div className="flex items-center gap-4">
                  <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-90 motion-reduce:transition-none"
                    />
                    <span className="min-w-0 flex-1 font-medium text-foreground">
                      {name}
                    </span>
                    <span className="text-right text-xs tabular-nums">
                      {counts.isError
                        ? "Count unavailable"
                        : counts.data
                          ? `${count.toLocaleString()} listings indexed`
                          : "Loading count…"}
                      {running
                        ? " · Indexing…"
                        : job?.state === "failed"
                          ? " · Index failed"
                          : ""}
                    </span>
                  </CollapsibleTrigger>
                  <ProviderAccessControl
                    transport={transport}
                    id={id}
                    name={name}
                    enabled={settings.config!.providers[id].enabled}
                    disabled={settings.isSaving || !!settings.readError}
                    onChange={(enabled) =>
                      settings.update({ providers: { [id]: { enabled } } })
                    }
                  />
                </div>
                <CollapsibleContent>
                  <div className="space-y-3 pb-1 pl-7 pt-4 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm text-muted-foreground">
                        Index listings for faster symbol search.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        disabled={!!reason || running || index.isPending}
                        onClick={() => {
                          if (id === "binance")
                            index.mutate({
                              providerId: id,
                              filter: {},
                            });
                        }}
                      >
                        {running ? "Indexing…" : "Index"}
                      </Button>
                    </div>
                    {reason ? (
                      <p className="text-xs text-muted-foreground">{reason}</p>
                    ) : null}
                    {running ? (
                      <div role="status" className="space-y-2">
                        <progress
                          aria-label={`Indexing ${name} listings`}
                          className="h-1.5 w-full accent-primary"
                        />
                        <p className="text-xs text-muted-foreground">
                          {job.phase === "fetching"
                            ? `Fetching ${job.filter.quoteAsset ? `${job.filter.quoteAsset} listings` : "the complete catalog"}…`
                            : "Saving listings…"}{" "}
                          You can leave this page.
                        </p>
                      </div>
                    ) : null}
                    {job?.state === "succeeded" ? (
                      <p
                        role="status"
                        className="text-xs text-muted-foreground"
                      >
                        Indexed {job.listingCount.toLocaleString()}{" "}
                        {job.filter.quoteAsset ?? "active Spot"} listings.
                      </p>
                    ) : null}
                  </div>
                </CollapsibleContent>
                <IndexFailure
                  provider={name}
                  job={job}
                  retry={() => {
                    if (id === "binance")
                      index.mutate({ providerId: id, filter: {} });
                  }}
                />
              </Collapsible>
            );
          })}
        </Card>
      ) : null}
    </SettingsPage>
  );
}

function IndexFailure({
  provider,
  job,
  retry,
}: {
  provider: string;
  job: SymbolIndexState | undefined;
  retry: () => void;
}) {
  const reason = job?.state === "failed" ? job.reason : undefined;
  useErrorToast(
    job?.state === "failed"
      ? `${describeFailure(reason ?? new ClientFailures.Internal())} The previous catalog was preserved.`
      : undefined,
    {
      id: `index:${provider}:${job && "runId" in job ? job.runId : "idle"}`,
      title: `Couldn’t index ${provider}`,
      // A failure without a public reason is internal and may be transient.
      retry: !reason || offersRetry(reason) ? retry : undefined,
    },
  );
  return null;
}
