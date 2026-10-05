// Purpose: Keep invitation and complimentary-access facts in the current account's billing cache.
import { useUser } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

/** Complimentary access is independent of subscription status. @example const access = useCloudAccess(transport); */
export function useCloudAccess(transport: AppTransport) {
  const { user } = useUser();
  return useQuery({
    queryKey: ["billing", user?.id, "access"],
    queryFn: ({ signal }) =>
      transport.rpc.access.billing.getAccess.query(undefined, { signal }),
    staleTime: 0,
    meta: { errorTitle: "Couldn’t refresh Cloud access" },
  });
}

/** Cloud owns issuance, lifetime limits and redemption. Subscription's focus/return refresh covers this cache too. @example const invites = useReferrals(transport); */
export function useReferrals(transport: AppTransport) {
  const { user } = useUser();
  const queries = useQueryClient();
  const billingKey = ["billing", user?.id] as const;
  const key = [...billingKey, "referrals"] as const;
  const referrals = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      transport.rpc.access.billing.getReferrals.query(undefined, { signal }),
    staleTime: 0,
    meta: { errorTitle: "Couldn’t load invitations" },
  });
  const issue = useMutation({
    mutationFn: () => transport.rpc.access.billing.issueReferrals.mutate(),
    onSuccess: (value) => queries.setQueryData(key, value),
    retry: false,
    gcTime: 0,
    meta: { errorTitle: "Couldn’t create invitations" },
  });
  const attempted = useRef(false);
  const issueCodes = issue.mutate;
  useEffect(() => {
    if (
      referrals.data?.canInvite &&
      referrals.data.codes.length === 0 &&
      !attempted.current
    ) {
      // Strict Mode may replay this effect. Never automatically retry a write.
      attempted.current = true;
      issueCodes();
    }
  }, [referrals.data, issueCodes]);
  const redeem = useMutation({
    mutationFn: (input: { code: string }) =>
      transport.rpc.access.billing.redeemReferral.mutate(input),
    onSuccess: (access, input) => {
      queries.setQueryData([...billingKey, "access"], access);
      queries.setQueryData<typeof referrals.data>(key, (previous) =>
        previous ? { ...previous, redeemedCode: input.code } : previous,
      );
    },
    // A lost response can hide a successful write. Reconcile facts on either
    // outcome; never replay the redemption automatically.
    onSettled: () => queries.invalidateQueries({ queryKey: billingKey }),
    retry: false,
    gcTime: 0,
    meta: { errorTitle: "Couldn’t redeem invitation" },
  });
  const redeemCode = (code: string, onConfirmed: () => void) =>
    redeem.mutate(
      { code },
      {
        // Per-call callbacks are dropped on unmount, including during the refresh.
        onSettled: (access) => {
          if (
            access ||
            queries.getQueryData<typeof referrals.data>(key)?.redeemedCode
          )
            onConfirmed();
        },
      },
    );
  return { referrals, issue, redeem, redeemCode };
}
