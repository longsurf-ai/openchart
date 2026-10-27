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
  viewportAroundInstant,
  visibleSpanMs,
  zonedWallFromUtcMs,
  zonedWallToUtcMs,
} from "@openchart/app/features/chart/utils/go-to-date";
import { useWidgetControls } from "@openchart/app/hooks/use-widget";
import type { ChartPreferencesStore } from "@openchart/app/lib/chart/preferences";
import type { ChartRuntime } from "@openchart/app/lib/chart/store";
import { chartSettings } from "@openchart/app/stores/chart";

const timeInputClassName =
  "appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none";

function calendarDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Open Go to date for the captured cell; focus changes never retarget an open dialog.
 * @example <GoToDateButton localStore={preferences} resolution={cell.resolution} chart={chart} />
 */
export function GoToDateButton({
  localStore,
  resolution,
  chart,
  disabled = false,
}: {
  localStore: ChartPreferencesStore;
  resolution: Resolution;
  chart: ChartRuntime;
  disabled?: boolean;
}) {
  const [target, setTarget] = useState<{
    localStore: ChartPreferencesStore;
    resolution: Resolution;
    chart: ChartRuntime;
  }>();
  useWidgetControls(!!target);
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
            onClick={() => setTarget({ localStore, resolution, chart })}
          >
            <CalendarIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Go to date</TooltipContent>
      </Tooltip>
      {target ? (
        <GoToDateDialog {...target} onClose={() => setTarget(undefined)} />
      ) : null}
    </>
  );
}

/** Choose a display-timezone date and apply it to this chart's saved viewport.
 * @example <GoToDateDialog localStore={preferences} resolution="1d" chart={chart} onClose={close} />
 */
export function GoToDateDialog({
  localStore,
  resolution,
  chart,
  onClose,
}: {
  localStore: ChartPreferencesStore;
  resolution: Resolution;
  chart: ChartRuntime;
  onClose: () => void;
}) {
  const timezone = useStore(chartSettings, (state) => state.timezone);
  const formId = useId();
  const [when, setWhen] = useState(() =>
    zonedWallFromUtcMs(defaultGoToInstant(localStore.getState()), timezone),
  );
  const [error, setError] = useState<string>();
  const zone = Tz.parse(timezone);
  const selected = new Date(`${when.date}T00:00`);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md lg:max-w-md xl:max-w-md"
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
            if (!when.time) {
              setError("Enter a valid time");
              return;
            }
            let at: number;
            try {
              at = zonedWallToUtcMs(when.date, when.time, timezone);
            } catch {
              setError("Enter a valid date");
              return;
            }
            if (!Number.isFinite(at)) {
              setError("Enter a valid date");
              return;
            }
            localStore.setState({
              viewport: viewportAroundInstant(at, {
                spanMs: visibleSpanMs(
                  localStore.getState(),
                  resolution,
                  chart.store.getState(),
                ),
              }),
              rightOffset: 0,
            });
            onClose();
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
                  setWhen((current) => ({
                    ...current,
                    date: calendarDate(date),
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
                value={when.time}
                onChange={(event) => {
                  setError(undefined);
                  setWhen((current) => ({
                    ...current,
                    time: event.target.value,
                  }));
                }}
              />
              <FieldDescription>Times use {zone.label}.</FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit">Go</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
