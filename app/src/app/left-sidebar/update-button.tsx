// Purpose: Offer a downloaded desktop update from the sidebar instead of interrupting with a dialog.
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@openchart/app/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import { useAppHost } from "@openchart/app/lib/host/host";

/** Hidden until Desktop has downloaded an update; clicking restarts through the normal Quit path. @example <AccountButton actions={<UpdateButton />} /> */
export function UpdateButton() {
  const { onUpdateReady, restartToUpdate } = useAppHost();
  const [release, setRelease] = useState<string>();
  useEffect(() => onUpdateReady(setRelease), [onUpdateReady]);
  if (!release) return null;
  const label = `Restart to install ${release}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-xs"
          aria-label={label}
          className="rounded-full bg-indicator-blue text-white hover:bg-indicator-blue/90"
          onClick={() => {
            restartToUpdate().catch((error: unknown) =>
              toast.error("Couldn’t restart to update", {
                description:
                  error instanceof Error ? error.message : String(error),
              }),
            );
          }}
        >
          <Download className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
