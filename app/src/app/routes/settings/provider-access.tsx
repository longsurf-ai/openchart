// Purpose: Render one access control for every data provider and coordinate explicit rechecks.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type {
  AppTransport,
  ProviderInputs,
} from "@openchart/app/lib/transport/transport";
import { Button } from "@openchart/app/components/ui/button";
import { Switch } from "@openchart/app/components/ui/form/switch";
import { SignInButton } from "@openchart/app/features/account/sign-in-button";
import { useAccount } from "@openchart/app/features/account/use-account";

const accessKey = ["provider-access"] as const;
const labels = {
  subscribe: "Subscribe",
  "manage-subscription": "Manage subscription",
};

/** Recheck provider activation after billing refresh, then invalidate access reads.
 * @example const refresh = useRefreshProviderAccess(transport);
 */
export function useRefreshProviderAccess(transport: AppTransport) {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: () => transport.rpc.providers.refresh.mutate(),
    onSuccess: () => queries.invalidateQueries({ queryKey: accessKey }),
    meta: { errorTitle: "Couldn’t refresh data providers" },
  });
}

/** Access chooses the action; only a granted access check exposes the enabled preference.
 * Access is rechecked whenever the local account changes, e.g. after modal sign-in.
 * @example <ProviderAccessControl transport={transport} id="binance" name="Binance" enabled onChange={save} disabled={false} />
 */
export function ProviderAccessControl({
  transport,
  id,
  name,
  enabled,
  disabled,
  onChange,
}: {
  transport: AppTransport;
  id: ProviderInputs["checkAccess"]["providerId"];
  name: string;
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const navigate = useNavigate();
  const refresh = useRefreshProviderAccess(transport);
  const local = useAccount(transport).data;
  const account = local?.status === "signed-in" ? local.user.id : null;
  const access = useQuery({
    queryKey: [...accessKey, id, account],
    queryFn: ({ signal }) =>
      transport.rpc.providers.checkAccess.query({ providerId: id }, { signal }),
    gcTime: 0,
    staleTime: 0,
    retry: false,
    meta: { errorTitle: `Couldn’t check ${name} access` },
  });
  if (access.isPending || access.isFetching || refresh.isPending)
    return (
      <span role="status" className="text-xs text-muted-foreground">
        Checking access…
      </span>
    );
  if (access.isError)
    return (
      <Button
        variant="outline"
        size="sm"
        aria-label={`Retry ${name} access`}
        onClick={() => refresh.mutate()}
      >
        Retry
      </Button>
    );
  if (access.data.status === "required")
    return access.data.action === "sign-in" ? (
      <SignInButton />
    ) : (
      <Button size="sm" onClick={() => navigate("/app/settings/subscription")}>
        {labels[access.data.action]}
      </Button>
    );
  return (
    <Switch
      id={`provider-${id}`}
      aria-label={`Enable ${name}`}
      checked={enabled}
      disabled={disabled}
      onCheckedChange={onChange}
    />
  );
}
