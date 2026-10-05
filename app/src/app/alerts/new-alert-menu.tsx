// Purpose: Share manual and Agent-led alert creation across app navigation and pages.
import { useRef, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  ChevronDownIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import { Button } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import { useCopilotControls } from "@openchart/app/app/agent/copilot-controls";

/** Offer manual editing or an unsent prompt in the current Copilot. @example <NewAlertMenu /> */
export function NewAlertMenu({ trigger }: { trigger?: ReactNode }) {
  const navigate = useNavigate();
  const copilot = useCopilotControls();
  const afterClose = useRef<() => void>();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm">
            <PlusIcon aria-hidden />
            New alert
            <ChevronDownIcon aria-hidden />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="neutral-controls"
        onCloseAutoFocus={(event) => {
          const action = afterClose.current;
          if (action) event.preventDefault();
          afterClose.current = undefined;
          action?.();
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            void navigate("/app/alerts/new");
          }}
        >
          <PencilIcon aria-hidden />
          Manual creation
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!copilot}
          onSelect={() => {
            afterClose.current = () =>
              copilot?.prefill("Create an alert when...");
          }}
        >
          <MessageSquareIcon aria-hidden />
          Create with agent
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
