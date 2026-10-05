// Purpose: Share bundled notification sound choices and disposable previews across alert drafts and Settings.
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Play, Volume2, VolumeX } from "lucide-react";
import {
  notificationSounds,
  type NotificationSound,
} from "@openchart/notification";
import { Button } from "@openchart/app/components/ui/button";
import { TooltipIconButton } from "@openchart/app/components/ui/tooltip-icon-button/tooltip-icon-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@openchart/app/components/ui/popover";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
import { cn } from "@openchart/app/utils/cn";

const soundOptions = [
  { id: "none", label: "None" },
  { id: "system", label: "System default" },
  ...notificationSounds,
] as const;

/** The caller owns saving; previews never select a sound or fire a notification. @example <NotificationSoundPicker value={sound} onChange={setSound} /> */
export function NotificationSoundPicker({
  id,
  value,
  disabled = false,
  iconOnly = false,
  onChange,
  onDefault,
}: {
  id?: string;
  value?: NotificationSound;
  disabled?: boolean;
  iconOnly?: boolean;
  onChange: (sound: NotificationSound) => void;
  onDefault?: () => void;
}) {
  const radioName = useId();
  const audio = useRef<HTMLAudioElement>();
  const selectedRadio = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [previewError, setPreviewError] = useState<Error>();
  useErrorToast(previewError, {
    id: `alert-sound-preview-${radioName}`,
    title: "Couldn’t preview sound.",
  });
  useEffect(() => () => audio.current?.pause(), []);
  const options = onDefault
    ? [{ id: undefined, label: "Use default" }, ...soundOptions]
    : soundOptions;
  const selectedLabel = options.find((item) => item.id === value)?.label;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          audio.current?.pause();
          audio.current = undefined;
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        {iconOnly ? (
          <TooltipIconButton
            id={id}
            type="button"
            className="size-8 text-muted-foreground"
            aria-label="Notification sound"
            tooltip={`Notification sound: ${selectedLabel}`}
            disabled={disabled}
          >
            {value === "none" ? (
              <VolumeX aria-hidden="true" />
            ) : (
              <Volume2 aria-hidden="true" />
            )}
          </TooltipIconButton>
        ) : (
          <Button
            id={id}
            type="button"
            variant="outline"
            className="w-52 max-w-full justify-between"
            aria-label="Notification sound"
            disabled={disabled}
          >
            {selectedLabel}
            <ChevronDown aria-hidden="true" className="size-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="neutral-controls w-64 p-1"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          selectedRadio.current?.focus();
        }}
      >
        <fieldset disabled={disabled}>
          <legend className="sr-only">Notification sound</legend>
          {options.map((item) => (
            <div
              key={item.id ?? "default"}
              className={cn(
                "flex items-center rounded-sm",
                item.id === value
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50",
              )}
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                <input
                  ref={item.id === value ? selectedRadio : undefined}
                  type="radio"
                  name={radioName}
                  value={item.id ?? "default"}
                  checked={item.id === value}
                  className="size-4 accent-primary"
                  onChange={() => {
                    audio.current?.pause();
                    audio.current = undefined;
                    setPreviewError(undefined);
                    if (item.id === undefined) onDefault?.();
                    else onChange(item.id);
                    setOpen(false);
                  }}
                />
                {item.label}
              </label>
              {"url" in item ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="mr-1 shrink-0"
                  aria-label={`Preview ${item.label}`}
                  onClick={() => {
                    audio.current?.pause();
                    setPreviewError(undefined);
                    const player = new Audio(item.url);
                    audio.current = player;
                    void player.play().catch((cause: unknown) => {
                      if (audio.current === player)
                        setPreviewError(
                          cause instanceof Error
                            ? cause
                            : new Error("The sound could not be played."),
                        );
                    });
                  }}
                >
                  <Play aria-hidden="true" className="size-4" />
                </Button>
              ) : null}
            </div>
          ))}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
