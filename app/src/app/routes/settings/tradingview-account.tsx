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
 * Reads the active TradingView account from the shared Integration query. Query
 * owns request cleanup and reports failures; no credentials enter the renderer.
 * A successful empty result means no account is connected.
 * @example const connection = useTradingViewConnection(transport);
 */
export function useTradingViewConnection(transport: AppTransport) {
  return useQuery({
    queryKey: integrationKey,
    queryFn: ({ signal }) =>
      transport.rpc.access.integration.listIntegrations.query(undefined, {
        signal,
      }),
    select: (integrations) =>
      integrations
        .find((integration) => integration.id === integrationID)
        ?.credentialSources.find((source) => source.active),
    meta: { errorTitle: "Couldn’t read the TradingView connection" },
  });
}

/**
 * Offers account choice before opening browser sign-in. Switching first lets
 * users select their own account in TradingView; the saved account remains
 * connected until Access successfully exchanges the one-time login link.
 * Closing or unmounting cancels the attempt and discards only the unsaved draft.
 * Failed writes retain the dialog for retry. Provider enablement stays with the
 * caller: an optional pending enable is confirmed after an anonymous choice or
 * successful login, and cancelled on close. Ordinary account actions never
 * change the provider preference.
 * @example <TradingViewAccount transport={transport} />
 */
export function TradingViewAccount({
  transport,
  enableRequest,
}: {
  transport: AppTransport;
  enableRequest?: {
    onConnected: () => void;
    onContinueWithoutSignIn: () => void;
    onCancel: () => void;
    isSaving: boolean;
  };
}) {
  const queries = useQueryClient();
  const refresh = useRefreshProviderAccess(transport);
  const inputID = useId();
  const [preparation, setPreparation] = useState<"connect" | "switch" | null>(
    null,
  );
  const [attempt, setAttempt] = useState<LoginAttempt | null>(null);
  const [link, setLink] = useState("");
  const [invalid, setInvalid] = useState(false);
  const activeAttempt = useRef<string | null>(null);
  const mounted = useRef(false);
  const connection = useTradingViewConnection(transport);
  const activeConnection = connection.data;
  const connected = Boolean(activeConnection);
  const switching = preparation === "switch";
  const open = Boolean(preparation || enableRequest || attempt);
  const clearAttempt = () => {
    activeAttempt.current = null;
    setAttempt(null);
    setPreparation(null);
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
      if (mounted.current) enableRequest?.onConnected();
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
  const writing =
    complete.isPending || cancel.isPending || enableRequest?.isSaving;
  const busy =
    start.isPending || open || disconnect.isPending || refresh.isPending;
  const close = () => {
    if (writing || start.isPending) return;
    if (!attempt) {
      setPreparation(null);
      enableRequest?.onCancel();
      return;
    }
    const attemptID = attempt.attemptID;
    cancel.mutate(attemptID, {
      onSuccess: () => {
        if (activeAttempt.current === attemptID) {
          clearAttempt();
          enableRequest?.onCancel();
        }
      },
    });
  };
  return (
    <>
      <CardItem
        className="flex-wrap gap-y-3"
        classNameWrapperAction="max-w-full"
        title="Your TradingView account"
        description={
          connection.isError
            ? "Connection status is unavailable."
            : connection.isPending
              ? "Checking connection…"
              : connected
                ? `Connected as ${activeConnection?.label}`
                : "Not connected"
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={connected ? "outline" : "default"}
                size="sm"
                className="h-auto min-h-8 max-w-full whitespace-normal"
                disabled={busy || connection.isPending}
                onClick={() => setPreparation(connected ? "switch" : "connect")}
              >
                {connected
                  ? "Switch account"
                  : "Connect your TradingView account"}
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
      <Dialog open={open} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-lg lg:max-w-lg xl:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {switching
                ? "Switch TradingView account"
                : "Connect your TradingView account"}
            </DialogTitle>
            <DialogDescription>
              {attempt
                ? attempt.instructions
                : switching
                  ? `Connected as ${activeConnection?.label}. In your browser, sign in to the TradingView account you want to use, then return here.`
                  : "Use your own account, or continue with public market data."}
            </DialogDescription>
          </DialogHeader>
          {!attempt ? (
            <>
              {switching ? (
                <Button
                  type="button"
                  variant="outline"
                  className="justify-self-start"
                  onClick={() =>
                    window.open(
                      "https://www.tradingview.com/",
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                >
                  Open TradingView
                </Button>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={start.isPending || writing}
                  onClick={() => {
                    if (switching) close();
                    else {
                      setPreparation(null);
                      enableRequest?.onContinueWithoutSignIn();
                    }
                  }}
                >
                  {switching ? "Cancel" : "Continue without signing in"}
                </Button>
                <Button
                  type="button"
                  disabled={start.isPending || writing}
                  onClick={() => start.mutate()}
                >
                  {start.isPending
                    ? "Opening browser…"
                    : switching
                      ? "Continue"
                      : "Connect account"}
                </Button>
              </DialogFooter>
            </>
          ) : (
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
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
