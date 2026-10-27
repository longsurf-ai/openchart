// Purpose: Connect TradingView through the user's normal browser and a one-time login link.
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import { Label } from "@openchart/app/components/ui/label";
import { SecretInput } from "@openchart/app/components/ui/secret-input";
import { CardItem } from "@openchart/app/components/ui/settings/card";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { useRefreshProviderAccess } from "./provider-access";

const integrationKey = ["integration", "tradingview"] as const;
const integrationID = "tradingview";
type LoginAttempt = Awaited<
  ReturnType<AppTransport["rpc"]["access"]["tradingview"]["start"]["mutate"]>
>;

function isLoginLink(value: string): boolean {
  if (value.length > 8192) return false;
  try {
    const url = new URL(value.trim());
    const token = url.searchParams.get("token");
    return (
      url.protocol === "tradingview:" &&
      url.host === "browser-auth" &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.searchParams.getAll("token").length === 1 &&
      token !== null &&
      token.length > 0 &&
      token.length <= 4096 &&
      !/\s/.test(token) &&
      [...url.searchParams.keys()].every((key) => key === "token")
    );
  } catch {
    return false;
  }
}

/**
 * Opens TradingView sign-in in the system browser, preserving its existing
 * account and passkey support. Access exchanges the pasted one-time link and
 * stores credentials server-side; the renderer retains only the unsaved draft.
 * Closing or unmounting cancels the attempt, and successful completion clears
 * the draft. Starting again awaits cancellation of the failed attempt and keeps
 * the dialog until its replacement opens, so an old callback cannot outlive it.
 * Query reports failures while failed writes preserve the dialog.
 * @example <TradingViewAccount transport={transport} />
 */
export function TradingViewAccount({ transport }: { transport: AppTransport }) {
  const queries = useQueryClient();
  const refresh = useRefreshProviderAccess(transport);
  const inputID = useId();
  const [attempt, setAttempt] = useState<LoginAttempt | null>(null);
  const [link, setLink] = useState("");
  const [invalid, setInvalid] = useState(false);
  const activeAttempt = useRef<string | null>(null);
  const mounted = useRef(false);
  const connection = useQuery({
    queryKey: integrationKey,
    queryFn: ({ signal }) =>
      transport.rpc.access.integration.listIntegrations.query(undefined, {
        signal,
      }),
    meta: { errorTitle: "Couldn’t read the TradingView connection" },
  });
  const activeConnection = connection.data
    ?.find((integration) => integration.id === integrationID)
    ?.credentialSources.find((source) => source.active);
  const connected = Boolean(activeConnection);
  const clearAttempt = () => {
    activeAttempt.current = null;
    setAttempt(null);
    setLink("");
    setInvalid(false);
  };
  const cancel = useMutation({
    mutationFn: (attemptID: string) =>
      transport.rpc.access.tradingview.cancel.mutate({ attemptID }),
    retry: false,
    meta: { errorTitle: "Couldn’t cancel TradingView sign-in" },
  });
  const cancelAttempt = cancel.mutate;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (activeAttempt.current) cancelAttempt(activeAttempt.current);
    };
  }, [cancelAttempt]);
  const start = useMutation({
    mutationFn: () => transport.rpc.access.tradingview.start.mutate(),
    retry: false,
    onSuccess: (next) => {
      if (!mounted.current) {
        cancelAttempt(next.attemptID);
        return;
      }
      activeAttempt.current = next.attemptID;
      complete.reset();
      setAttempt(next);
      setLink("");
      setInvalid(false);
      window.open(next.url, "_blank", "noopener,noreferrer");
    },
    meta: { errorTitle: "Couldn’t start TradingView sign-in" },
  });
  const complete = useMutation({
    mutationFn: async () => {
      if (!attempt) return;
      await transport.rpc.access.tradingview.complete.mutate({
        attemptID: attempt.attemptID,
        proof: attempt.proof,
        link: link.trim(),
      });
    },
    retry: false,
    gcTime: 0,
    onSuccess: () => {
      clearAttempt();
      refresh.mutate();
      void queries.invalidateQueries({ queryKey: integrationKey });
    },
    meta: { errorTitle: "Couldn’t connect TradingView" },
  });
  const disconnect = useMutation({
    mutationFn: () =>
      transport.rpc.access.integration.connection.disconnect.mutate({
        integrationID,
      }),
    retry: false,
    onSuccess: () => {
      refresh.mutate();
      void queries.invalidateQueries({ queryKey: integrationKey });
    },
    meta: { errorTitle: "Couldn’t disconnect TradingView" },
  });
  const writing = complete.isPending || cancel.isPending;
  const busy =
    start.isPending ||
    Boolean(attempt) ||
    disconnect.isPending ||
    refresh.isPending;
  const close = () => {
    if (!attempt || writing || start.isPending) return;
    const attemptID = attempt.attemptID;
    cancel.mutate(attemptID, {
      onSuccess: () => {
        if (activeAttempt.current === attemptID) clearAttempt();
      },
    });
  };
  return (
    <>
      <CardItem
        title="TradingView account"
        description={
          connection.isError
            ? "Connection status is unavailable."
            : connection.isPending
              ? "Checking connection…"
              : connected
                ? `Connected as ${activeConnection?.label}`
                : "Optional. Connect to use your account’s history depth and data entitlements; anonymous data works without it."
        }
        actions={
          connection.isError ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={connection.isFetching}
              aria-label="Retry TradingView connection"
              onClick={() => void connection.refetch()}
            >
              Retry
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={connected ? "outline" : "default"}
                size="sm"
                disabled={busy || connection.isPending}
                onClick={() => start.mutate()}
              >
                {start.isPending
                  ? "Opening browser…"
                  : connected
                    ? "Reconnect"
                    : "Connect account"}
              </Button>
              {connected ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => disconnect.mutate()}
                >
                  Disconnect
                </Button>
              ) : null}
            </div>
          )
        }
      />
      <Dialog open={Boolean(attempt)} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect TradingView</DialogTitle>
            <DialogDescription>{attempt?.instructions}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (writing || start.isPending) return;
              if (complete.isError && attempt) {
                // The dialog keeps the failed draft until its released attempt is replaced.
                cancel.mutate(attempt.attemptID, {
                  onSuccess: () => start.mutate(),
                });
                return;
              }
              if (!isLoginLink(link)) {
                setInvalid(true);
                return;
              }
              complete.mutate();
            }}
          >
            {!complete.isError ? (
              <Button
                type="button"
                variant="outline"
                className="justify-self-start"
                disabled={writing}
                onClick={() => {
                  if (attempt)
                    window.open(attempt.url, "_blank", "noopener,noreferrer");
                }}
              >
                Return to browser
              </Button>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor={inputID}>Login link</Label>
              <SecretInput
                id={inputID}
                autoComplete="off"
                spellCheck={false}
                maxLength={8192}
                value={link}
                disabled={writing || complete.isError}
                placeholder="Paste the copied link"
                aria-invalid={invalid}
                aria-describedby={invalid ? `${inputID}-error` : undefined}
                onChange={(event) => {
                  setLink(event.target.value);
                  setInvalid(false);
                }}
              />
              {invalid ? (
                <p
                  id={`${inputID}-error`}
                  role="alert"
                  className="text-sm text-destructive"
                >
                  Paste the login link copied from TradingView.
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={writing || start.isPending}
                onClick={close}
              >
                {cancel.isPending ? "Cancelling…" : "Cancel"}
              </Button>
              <Button type="submit" disabled={writing || start.isPending}>
                {start.isPending
                  ? "Opening browser…"
                  : complete.isError
                    ? "Start again"
                    : complete.isPending
                      ? "Connecting…"
                      : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
