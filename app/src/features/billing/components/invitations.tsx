// Purpose: Offer lifetime invitations and account-wide redemption without implying a subscription.
import { useId, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@openchart/app/components/ui/button";
import { Input } from "@openchart/app/components/ui/input";
import { Card } from "@openchart/app/components/ui/settings/card";
import {
  useCloudAccess,
  useReferrals,
} from "@openchart/app/features/billing/api/use-referrals";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { InvitationCard } from "./invitation-card";

/** All signed-in accounts may redeem, including accounts with no plan. @example <Invitations transport={transport} onAccessChange={refreshProviders} /> */
export function Invitations({
  transport,
  onAccessChange,
}: {
  transport: AppTransport;
  onAccessChange?: () => void;
}) {
  const { referrals, issue, redeem, redeemCode } = useReferrals(transport);
  const access = useCloudAccess(transport);
  const [code, setCode] = useState("");
  const inputId = useId();
  const redeemed = Boolean(referrals.data?.redeemedCode) || redeem.isSuccess;
  const codes = referrals.data?.codes ?? [];
  const normalizedCode = code.trim().toUpperCase();
  const isOwnCode = codes.some((item) => item.code === normalizedCode);
  const until = access.data?.complimentaryAccessUntil;
  const hasComplimentaryAccess =
    until && new Date(until).getTime() > Date.now();
  return (
    <div className="space-y-8">
      {(referrals.isPending ||
        referrals.isError ||
        referrals.data?.canInvite ||
        codes.length > 0) && (
        <section aria-labelledby={`${inputId}-invitations`}>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id={`${inputId}-invitations`}
              className="font-studio text-base font-medium"
            >
              Invite friends
            </h2>
            {codes.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {codes.filter((item) => !item.redeemed).length} of{" "}
                {codes.length} left
              </span>
            )}
          </div>
          {(referrals.data?.canInvite || codes.length > 0) && (
            <p className="mb-4 text-sm text-muted-foreground">
              Invite friends. <strong>You both get 30 days</strong> of unlimited
              data access.
            </p>
          )}
          {codes.length > 0 ? (
            <ul
              aria-label="Your invitation codes"
              className="flex flex-wrap justify-center gap-3"
            >
              {codes.map((item, index) => (
                <InvitationCard key={item.code} {...item} number={index + 1} />
              ))}
            </ul>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {referrals.isError || issue.isError
                ? "Invitations are unavailable. Try again."
                : "Preparing your invitations…"}
            </p>
          )}
          {(referrals.isError || issue.isError) && (
            <Button
              variant="outline"
              className="mt-3"
              disabled={referrals.isFetching || issue.isPending}
              onClick={() => {
                if (issue.isError) issue.mutate();
                else void referrals.refetch();
              }}
            >
              Retry invitations
            </Button>
          )}
        </section>
      )}
      <Card title="Redeem an invite">
        {redeemed ? (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-foreground"
          >
            <Check className="size-4 shrink-0" />
            {redeem.isSuccess
              ? "Invite redeemed. You both received 30 extra days."
              : "You’ve already redeemed an invite."}
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!normalizedCode || isOwnCode || redeem.isPending) return;
              redeemCode(normalizedCode, () => {
                setCode("");
                onAccessChange?.();
              });
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={inputId}
                name="invitation-code"
                aria-label="Invitation code"
                className="min-w-48 flex-1 font-mono text-foreground"
                placeholder="Invitation code"
                pattern="\s*[A-Fa-f0-9]{6}\s*"
                title="Enter your 6-character OpenChart invitation code."
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={isOwnCode}
                aria-describedby={isOwnCode ? `${inputId}-error` : undefined}
                value={code}
                disabled={redeem.isPending}
                onChange={(event) => setCode(event.target.value)}
              />
              <Button
                type="submit"
                disabled={!normalizedCode || isOwnCode || redeem.isPending}
              >
                {redeem.isPending ? "Redeeming…" : "Redeem code"}
              </Button>
            </div>
            {isOwnCode && (
              <p
                id={`${inputId}-error`}
                role="alert"
                className="mt-2 text-sm text-destructive"
              >
                You cannot redeem your own invitation code.
              </p>
            )}
          </form>
        )}
        {hasComplimentaryAccess && (
          <p role="status" className="mt-4 text-sm text-foreground">
            Free Cloud access until{" "}
            {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
              new Date(until),
            )}
            .
          </p>
        )}
      </Card>
    </div>
  );
}
