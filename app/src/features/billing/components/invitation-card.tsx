// THESIS: Three shareable tickets turn a subscription into extra charting time for friends.
// OWN-WORLD: Extend OpenChart Settings with the user's pastel, perforated ticket reference.
// STORY: See each one-use code, copy it, and recognize a redeemed ticket at a glance.
// FIRST VIEWPORT: Three compact tickets sit side by side, centered beneath subscription details.
// FORM: Mint-to-lilac paper, a branded stub, readable codes and a compact copy action.
import { useMutation } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { OpenChartMark } from "@openchart/app/components/ui/brand/openchart-mark";
import { Button } from "@openchart/app/components/ui/button";
import "./invitation-card.css";

/** A single server-issued, one-use invitation. @example <InvitationCard code={code} redeemed={false} number={1} /> */
export function InvitationCard({
  code,
  redeemed,
  number,
}: {
  code: string;
  redeemed: boolean;
  number: number;
}) {
  const copy = useMutation({
    mutationFn: () => navigator.clipboard.writeText(code),
    retry: false,
    gcTime: 0,
    meta: { errorTitle: "Couldn’t copy invitation code" },
  });
  return (
    <li className="invitation-ticket w-56" data-redeemed={redeemed}>
      <div className="invitation-ticket-stub" aria-hidden="true">
        <OpenChartMark className="size-5 shrink-0" />
        <span className="font-studio text-sm font-medium">OpenChart</span>
      </div>
      <div className="min-w-0 space-y-3 px-4 py-5">
        <h3 className="sr-only">Invite {number}</h3>
        <code className="block select-text font-mono text-2xl font-medium tracking-wide">
          {code}
        </code>
        <Button
          variant="outline"
          className="invitation-ticket-copy w-full"
          aria-label={
            redeemed
              ? `Invite ${number} redeemed`
              : `${copy.isSuccess ? "Copied" : "Copy"} invite ${number}`
          }
          disabled={redeemed || copy.isPending}
          onClick={() => copy.mutate()}
        >
          {copy.isSuccess || redeemed ? <Check /> : <Copy />}
          <span aria-live="polite">
            {redeemed ? "Redeemed" : copy.isSuccess ? "Copied" : "Copy code"}
          </span>
        </Button>
      </div>
    </li>
  );
}
