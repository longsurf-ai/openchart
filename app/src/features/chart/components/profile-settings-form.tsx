// Purpose: Edit a volume profile's settings: the bars it counts and its number of volume bars.
import { useState } from "react";
import {
  resolutionMs,
  type BarsSeries,
  type Resolution,
} from "@openchart/feed";
import { Button } from "@openchart/app/components/ui/button";
import { Input } from "@openchart/app/components/ui/input";
import { CardItem } from "@openchart/app/components/ui/settings/card";
import { DropdownControl } from "@openchart/app/components/ui/settings/dropdown-control";
import type { ProfileBars } from "@openchart/app/features/chart/components/sources/volume-profile";
import { resolutionsUpTo } from "@openchart/app/features/chart/utils/resolutions";
import { useBarsCapabilities } from "@openchart/app/hooks/use-bars";

/** A volume profile's saved settings; an absent one keeps its default. */
export interface ProfileSettings {
  /** The bars it counts. The default is the finest that fit its range. */
  readonly resolution?: Resolution;
  /** Its price rows, 1 to 100. The default is 24. */
  readonly rows?: number;
}

const defaultRows = 24;

/**
 * The Inputs of a volume profile's settings. "Lower timeframe" offers the
 * bars the provider serves at the chart's session and adjustment, from 1m up
 * to the chart's own, and shows `inUse`, the bars counted now, until one is
 * chosen; when a saved choice isn't what is counted, it says which bars are
 * and why, such as the provider's retention. "Number of volume bars" takes 1
 * to 100. "Use default" clears a choice; Save hands both to `onSave`.
 * @example <ProfileSettingsForm series={series} saved={{}} inUse={{ resolution: "4h" }} onSave={save} />
 */
export function ProfileSettingsForm({
  series,
  saved,
  inUse,
  onSave,
}: {
  series: BarsSeries;
  saved: ProfileSettings;
  inUse: ProfileBars | undefined;
  onSave: (settings: ProfileSettings) => Promise<unknown>;
}) {
  const capabilities = useBarsCapabilities({
    provider: series.provider,
    listing: series.listing,
  });
  const options = resolutionsUpTo(series, capabilities.data ?? []).filter(
    (resolution) => resolutionMs[resolution] >= resolutionMs["1m"],
  );
  const [draft, setDraft] = useState<{
    resolution?: Resolution;
    rows?: string;
  }>({
    resolution: saved.resolution,
    rows: saved.rows === undefined ? undefined : String(saved.rows),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const shown = draft.resolution ?? inUse?.resolution;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const rows = draft.rows === undefined ? undefined : Number(draft.rows);
        if (
          rows !== undefined &&
          !(Number.isInteger(rows) && rows >= 1 && rows <= 100)
        ) {
          setError(
            "Number of volume bars must be a whole number from 1 to 100.",
          );
          return;
        }
        setError(undefined);
        setSaving(true);
        // The chart mutation reports save failures; keep the draft to retry.
        void onSave({
          ...(draft.resolution ? { resolution: draft.resolution } : {}),
          ...(rows === undefined ? {} : { rows }),
        })
          .catch(() => {})
          .finally(() => setSaving(false));
      }}
    >
      <div className="text-sm">
        <CardItem
          className="flex-wrap gap-3"
          classNameWrapperAction="ml-auto max-w-full"
          title="Lower timeframe"
          htmlFor="profile-resolution"
          description={
            saved.resolution && inUse && inUse.resolution !== saved.resolution
              ? inUse.note
                ? `Using ${inUse.resolution}: ${inUse.note}`
                : `Using ${inUse.resolution} here`
              : undefined
          }
          actions={
            <div className="flex items-center gap-2">
              {draft.resolution ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label="Reset Lower timeframe"
                  disabled={saving}
                  onClick={() => setDraft({ ...draft, resolution: undefined })}
                >
                  Use default
                </Button>
              ) : null}
              <div className="w-40">
                <DropdownControl
                  id="profile-resolution"
                  value={shown ?? ""}
                  selectedLabel={shown ? undefined : "Default"}
                  options={options.map((value) => ({ value, name: value }))}
                  onChange={(value) =>
                    setDraft({ ...draft, resolution: value as Resolution })
                  }
                  disabled={saving || !options.length}
                />
              </div>
            </div>
          }
        />
        <CardItem
          className="flex-wrap gap-3"
          classNameWrapperAction="ml-auto max-w-full"
          title="Number of volume bars"
          htmlFor="profile-rows"
          actions={
            <div className="flex items-center gap-2">
              {draft.rows !== undefined ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label="Reset Number of volume bars"
                  disabled={saving}
                  onClick={() => setDraft({ ...draft, rows: undefined })}
                >
                  Use default
                </Button>
              ) : null}
              <Input
                id="profile-rows"
                type="number"
                className="h-8 w-20"
                min={1}
                max={100}
                step={1}
                value={draft.rows ?? String(defaultRows)}
                onChange={(event) =>
                  setDraft({ ...draft, rows: event.target.value })
                }
                disabled={saving}
              />
            </div>
          }
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="sm" className="self-end" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
