// Purpose: Jump the focused chart to a civil date in the display timezone.
import { CalendarIcon } from "lucide-react";
import { useId, useState } from "react";
import { useStore } from "zustand";
import * as Tz from "@openchart/chart-core/tz/types";
import type { Resolution } from "@openchart/feed";

import { Button } from "@openchart/app/components/ui/button";
import { Calendar } from "@openchart/app/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@openchart/app/components/ui/field";
import { Input } from "@openchart/app/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import {
  defaultGoToInstant,
  formatClock,
  instantToZonedParts,
  parseClock,
  viewportAroundInstant,
  visibleSpanMs,
  zonedCivilToUtcMs,
  type ZonedCivilTime,
} from "@openchart/app/features/chart/utils/go-to-date";
import { useWidgetControls } from "@openchart/app/hooks/use-widget";
import type {
  ChartPreferences,
  ChartPreferencesStore,
} from "@openchart/app/lib/chart/preferences";
import { chartSettings } from "@openchart/app/stores/chart";

const timeInputClassName =
  "appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none";

function civilToDate(civil: Pick<ZonedCivilTime, "year" | "month" | "day">) {
  return new Date(civil.year, civil.month - 1, civil.day);
}

function dateToCivil(
  date: Date,
): Pick<ZonedCivilTime, "year" | "month" | "day"> {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

/** Open the Go to date dialog with this cell's saved window as the starting point.
 * @example <GoToDateButton localStore={preferences} resolution={cell.resolution} />
 */
export function GoToDateButton({
  localStore,
  resolution,
  disabled = false,
}: {
  localStore: ChartPreferencesStore;
  resolution: Resolution;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useWidgetControls(open);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            disabled={disabled}
            aria-label="Go to date"
            onClick={() => setOpen(true)}
          >
            <CalendarIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Go to date</TooltipContent>
      </Tooltip>
      {open ? (
        <GoToDateDialog
          localStore={localStore}
          resolution={resolution}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Choose a display-timezone date and apply it to this chart's saved viewport.
 * @example <GoToDateDialog localStore={preferences} resolution="1d" onClose={close} />
 */
export function GoToDateDialog({
  localStore,
  resolution,
  onClose,
}: {
  localStore: ChartPreferencesStore;
  resolution: Resolution;
  onClose: () => void;
}) {
  const timezone = useStore(chartSettings, (state) => state.timezone);
  const formId = useId();
  const [civil, setCivil] = useState(() =>
    instantToZonedParts(defaultGoToInstant(localStore.getState()), timezone),
  );
  const [time, setTime] = useState(() => formatClock(civil.hour, civil.minute));
  const [error, setError] = useState<string>();
  const zone = Tz.parse(timezone);
  const selected = civilToDate(civil);
  const go = (viewport: ChartPreferences["viewport"]) => {
    localStore.setState({ viewport, rightOffset: 0 });
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        aria-describedby={`${formId}-copy`}
      >
        <DialogHeader>
          <DialogTitle>Go to date</DialogTitle>
          <DialogDescription id={`${formId}-copy`}>
            Jump this chart to a date in the display timezone.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const clock = parseClock(time);
            if (!clock) {
              setError("Enter a valid time");
              return;
            }
            const at = zonedCivilToUtcMs({ ...civil, ...clock }, timezone);
            if (!Number.isFinite(at)) {
              setError("Enter a valid date");
              return;
            }
            go(
              viewportAroundInstant(at, {
                spanMs: visibleSpanMs(localStore.getState(), resolution),
              }),
            );
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel>Date</FieldLabel>
              <Calendar
                mode="single"
                selected={selected}
                defaultMonth={selected}
                onSelect={(date) => {
                  if (!date) return;
                  setError(undefined);
                  setCivil((previous) => ({
                    ...previous,
                    ...dateToCivil(date),
                  }));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${formId}-time`}>Time</FieldLabel>
              <Input
                id={`${formId}-time`}
                type="time"
                step={60}
                className={timeInputClassName}
                value={time}
                onChange={(event) => {
                  setError(undefined);
                  setTime(event.target.value);
                }}
              />
              <FieldDescription>Times use {zone.label}.</FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => go(null)}>
              Go to latest
            </Button>
            <Button type="submit">Go</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
