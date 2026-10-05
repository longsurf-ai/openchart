// Purpose: Keep Resource recovery actions available after Query reports a failure.
import { Button } from "@openchart/app/components/ui/button";

/** Offer recovery after an operation failure without discarding its caller's draft. @example <ResourceNotice error={query.error} onRetry={() => void query.refetch()} /> */
export function ResourceNotice({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry?: () => void;
}) {
  return error && onRetry ? (
    <Button type="button" variant="link" size="sm" onClick={onRetry}>
      Retry
    </Button>
  ) : null;
}
