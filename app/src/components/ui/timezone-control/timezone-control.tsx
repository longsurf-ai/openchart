// Purpose: Share the chart's display-timezone menu without owning a feature's preferences.
import * as Tz from "@openchart/chart-core/tz/types";
import { ChevronDown, Clock3 } from "lucide-react";
import { Button } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import { cn } from "@openchart/app/utils/cn";

/**
 * Controlled display-timezone selector using the chart's common choices.
 * The caller owns value persistence and formatting; selection only calls
 * onValueChange. Radix owns menu dismissal, focus restoration and cleanup.
 * Compact mode retains the chart's icon and tooltip (requires TooltipProvider).
 * Accepts Local, UTC or a valid IANA zone; invalid values are caller errors.
 * @example <TimezoneControl value={timezone} onValueChange={setTimezone} />
 */
export function TimezoneControl({
  value,
  onValueChange,
  onOpenChange,
  compact = false,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  compact?: boolean;
  className?: string;
}) {
  const zone = Tz.parse(value);
  const label = `Time zone: ${zone.label}`;
  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size={compact ? "icon-xs" : "sm"}
        className={cn(
          "text-xs text-muted-foreground transition-colors hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground motion-reduce:transition-none",
          compact ? "size-7 rounded-sm p-0 font-semibold" : "px-2 font-normal",
          className,
        )}
        aria-label={label}
      >
        <Clock3 className="size-4" aria-hidden="true" />
        {!compact ? (
          <>
            <span>{zone.label}</span>
            <ChevronDown className="size-3" aria-hidden="true" />
          </>
        ) : null}
      </Button>
    </DropdownMenuTrigger>
  );
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent
        side="top"
        align={compact ? "end" : "start"}
        className="max-h-80 overflow-y-auto"
      >
        <DropdownMenuLabel>Time zone</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {Tz.common().map((choice) => (
            <DropdownMenuRadioItem key={choice.name} value={choice.name}>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
