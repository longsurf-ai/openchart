// Purpose: Edit chart display preferences through the shared series settings dialog.
import { v2 } from "@openchart/chart-core";
import { Color } from "@openchart/chart-core/util";
import { useId, useState, type ReactNode } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@openchart/app/components/ui/tabs";
import { useStore } from "zustand";
import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@openchart/app/components/ui/dialog";
import { Input } from "@openchart/app/components/ui/input";
import { Switch } from "@openchart/app/components/ui/form/switch";
import { CardItem } from "@openchart/app/components/ui/settings/card";
import { DropdownControl } from "@openchart/app/components/ui/settings/dropdown-control";
import { useChart } from "@openchart/app/hooks/use-chart";
import { useWidgetControls } from "@openchart/app/hooks/use-widget";
import { cn } from "@openchart/app/utils/cn";
import {
  defaultSeriesPreferences,
  updateSeriesStyles,
  PriceType,
  type SeriesPreferences,
  type ChartPreferencesStore,
} from "@openchart/app/lib/chart/preferences";

const lineStyles = ["solid", "dashed", "dotted"].map((value) => ({
  value,
  name: value,
}));

/** Edit display preferences in this chart. The output list controls visibility
 * independently of the selected output's appearance. Selection is local to the
 * dialog; style choices persist by binding ID and never restart Tea.
 * @example <SeriesStyleDialog seriesId={id} localStore={preferences} onClose={close} />
 */
export function SeriesStyleDialog({
  seriesId,
  inputs,
  outputs,
  profileIds = [],
  localStore,
  onClose,
}: {
  seriesId?: string;
  inputs?: ReactNode;
  /** Bound indicator outputs. Checkboxes suppress an output or restore its script
   * visibility; choices persist locally and never change the Tea execution. */
  outputs?: readonly { id: string; name: string }[];
  /** Bindings that draw vertical profiles; their appearance panel lists part colors. */
  profileIds?: readonly string[];
  localStore: ChartPreferencesStore;
  onClose: () => void;
}) {
  const chart = useChart();
  const hasSeries = useStore(chart.store, (state) =>
    Boolean(seriesId && v2.ChartStateUtils.getSeries(state, seriesId)),
  );
  const [selectedId, setSelectedId] = useState(seriesId ?? outputs?.[0]?.id);
  const selectedOutput =
    outputs?.find(({ id }) => id === selectedId) ?? outputs?.[0];
  const appearanceId = useId();
  useWidgetControls(true);
  const hasStyle = hasSeries || Boolean(outputs?.length || profileIds.length);
  if (!hasStyle && !inputs) return null;
  const style = selectedOutput ? (
    <div className="grid gap-5 text-sm md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <ul
        aria-label="Indicator outputs"
        className="min-w-0 space-y-1 border-b border-border pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-5"
      >
        {outputs?.map((output) => (
          <IndicatorOutputRow
            key={output.id}
            output={output}
            selected={selectedOutput.id === output.id}
            onSelect={() => setSelectedId(output.id)}
            appearanceId={appearanceId}
            localStore={localStore}
          />
        ))}
      </ul>
      <section
        id={appearanceId}
        aria-label={`${selectedOutput.name} style settings`}
        className="min-w-0"
      >
        <h3 className="mb-4 font-medium">Appearance</h3>
        <IndicatorOutputAppearance
          seriesId={selectedOutput.id}
          profile={profileIds.includes(selectedOutput.id)}
          localStore={localStore}
        />
      </section>
    </div>
  ) : (
    <div className="space-y-3 text-sm">
      {seriesId ? (
        <SeriesStyleFields seriesId={seriesId} localStore={localStore} />
      ) : null}
      {profileIds.length ? (
        <ProfilePartColors bindingIds={profileIds} localStore={localStore} />
      ) : null}
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "max-h-[calc(100dvh-2rem)] overflow-y-auto",
          outputs?.length ? "sm:max-w-xl lg:max-w-3xl" : "sm:max-w-md",
        )}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          chart.renderer.canvas.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Series settings</DialogTitle>
          <DialogDescription>
            {outputs?.length
              ? "Select an output to edit its appearance."
              : "Changes apply to this series in this chart."}
          </DialogDescription>
        </DialogHeader>
        {inputs ? (
          <Tabs defaultValue="inputs">
            <TabsList aria-label="Series settings sections">
              <TabsTrigger value="inputs">Inputs</TabsTrigger>
              <TabsTrigger value="style" disabled={!hasStyle}>
                {outputs ? "Outputs & style" : "Style"}
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="inputs"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              {inputs}
            </TabsContent>
            <TabsContent value="style">{style}</TabsContent>
          </Tabs>
        ) : (
          style
        )}
      </DialogContent>
    </Dialog>
  );
}

// Visibility and selection are sibling controls. Toggling a checkbox never
// changes which output the appearance panel is editing.
function IndicatorOutputRow({
  output,
  selected,
  onSelect,
  appearanceId,
  localStore,
}: {
  output: { id: string; name: string };
  selected: boolean;
  onSelect: () => void;
  appearanceId: string;
  localStore: ChartPreferencesStore;
}) {
  const chart = useChart();
  const color = useStore(chart.store, (state) => {
    const options = v2.ChartStateUtils.getSeries(state, output.id)?.options as
      Record<string, unknown> | undefined;
    const value = options?.color ?? options?.lineColor ?? options?.upColor;
    return typeof value === "string" ? value : undefined;
  });
  const saved = useStore(localStore, (state) => state.series[output.id]);
  return (
    <li
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-md border-l-2 px-2",
        selected ? "border-foreground bg-muted" : "border-transparent",
      )}
    >
      <input
        type="checkbox"
        aria-label={`Show ${output.name}`}
        className="size-4 shrink-0 cursor-pointer accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        checked={saved?.visible !== false}
        onChange={(event) =>
          updateSeriesStyles(localStore, [output.id], {
            visible: event.target.checked ? undefined : false,
          })
        }
      />
      <Button
        variant="ghost"
        size="sm"
        className="min-w-0 flex-1 justify-start gap-2 px-1 text-left"
        aria-label={`${output.name} style`}
        aria-pressed={selected}
        aria-controls={appearanceId}
        onClick={onSelect}
      >
        <span
          aria-hidden="true"
          className="size-3 shrink-0 rounded-full bg-muted-foreground/40"
          style={{ backgroundColor: saved?.color ?? color }}
        />
        <span className="truncate">{output.name}</span>
      </Button>
    </li>
  );
}

function IndicatorOutputAppearance({
  seriesId,
  profile,
  localStore,
}: {
  seriesId: string;
  profile: boolean;
  localStore: ChartPreferencesStore;
}) {
  const chart = useChart();
  const hasSeries = useStore(chart.store, (state) =>
    Boolean(v2.ChartStateUtils.getSeries(state, seriesId)),
  );
  if (profile)
    return (
      <ProfilePartColors bindingIds={[seriesId]} localStore={localStore} />
    );
  if (hasSeries)
    return (
      <SeriesStyleFields
        seriesId={seriesId}
        colorFirst
        localStore={localStore}
      />
    );
  return (
    <p className="text-muted-foreground">
      This output uses the indicator’s default style.
    </p>
  );
}

// Shared style fields for a market series or the selected indicator output.
function SeriesStyleFields({
  seriesId,
  colorFirst = false,
  localStore,
}: {
  seriesId: string;
  colorFirst?: boolean;
  localStore: ChartPreferencesStore;
}) {
  const chart = useChart();
  const editedSeries = useStore(chart.store, (state) =>
    v2.ChartStateUtils.getSeries(state, seriesId),
  );
  const saved = useStore(localStore, (state) => state.series[seriesId]);
  if (!editedSeries) return null;
  const editedStyle = {
    ...defaultSeriesPreferences,
    ...editedSeries.options,
    ...saved,
    type: (saved?.type ??
      editedSeries.type ??
      defaultSeriesPreferences.type) as SeriesPreferences["type"],
  };
  const candle = editedStyle.type === "Candlestick";
  const priceBars = candle || editedStyle.type === "Bar";
  const colorFields = [
    ...(priceBars
      ? ([
          ["upColor", "Up body"],
          ["downColor", "Down body"],
        ] as const)
      : []),
    ...(candle
      ? ([
          ["wickUpColor", "Up wick"],
          ["wickDownColor", "Down wick"],
          ["borderUpColor", "Up border"],
          ["borderDownColor", "Down border"],
        ] as const)
      : []),
  ];
  const setStyle = (id: string, change: Partial<SeriesPreferences>) =>
    updateSeriesStyles(localStore, [id], change);
  const color = (
    <SeriesColorSetting
      seriesId={seriesId}
      label="Color"
      localStore={localStore}
    />
  );
  return (
    <div className="text-sm">
      {colorFirst ? color : null}
      {editedSeries.type !== "Histogram" ? (
        <CardItem
          title="Type"
          htmlFor={`series-type-${seriesId}`}
          actions={
            <div className="w-40">
              <DropdownControl
                id={`series-type-${seriesId}`}
                value={editedStyle.type}
                options={PriceType.options
                  .filter(
                    (value) =>
                      editedSeries.fieldMap?.value !== "value" ||
                      (value !== "Candlestick" && value !== "Bar"),
                  )
                  .map((value) => ({
                    value,
                    name: value,
                  }))}
                onChange={(value) =>
                  setStyle(editedSeries.id, {
                    type: PriceType.parse(String(value)),
                  })
                }
              />
            </div>
          }
        />
      ) : null}
      {!colorFirst ? color : null}
      {colorFields.map(([field, label]) => (
        <SeriesColorSetting
          key={field}
          seriesId={editedSeries.id}
          label={label}
          field={field}
          localStore={localStore}
        />
      ))}
      {candle
        ? (
            [
              ["wickVisible", "Wicks"],
              ["borderVisible", "Borders"],
            ] as const
          ).map(([field, label]) => (
            <CardItem
              key={field}
              title={label}
              htmlFor={`series-${field}-${seriesId}`}
              actions={
                <Switch
                  id={`series-${field}-${seriesId}`}
                  checked={editedStyle[field]}
                  onCheckedChange={(checked) =>
                    setStyle(editedSeries.id, { [field]: checked })
                  }
                />
              }
            />
          ))
        : null}
      {!priceBars && editedSeries.type !== "Histogram" ? (
        <>
          <CardItem
            title="Line width"
            htmlFor={`series-line-width-${seriesId}`}
            actions={
              <Input
                id={`series-line-width-${seriesId}`}
                type="number"
                className="h-8 w-20"
                min={0.5}
                max={10}
                step={0.5}
                value={editedStyle.lineWidth}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (value >= 0.5 && value <= 10)
                    setStyle(editedSeries.id, {
                      lineWidth: value,
                    });
                }}
              />
            }
          />
          <CardItem
            title="Line style"
            htmlFor={`series-line-style-${seriesId}`}
            actions={
              <div className="w-32">
                <DropdownControl
                  id={`series-line-style-${seriesId}`}
                  value={editedStyle.lineStyle}
                  options={lineStyles}
                  onChange={(value) =>
                    setStyle(editedSeries.id, {
                      lineStyle: String(
                        value,
                      ) as SeriesPreferences["lineStyle"],
                    })
                  }
                />
              </div>
            }
          />
        </>
      ) : null}
      <CardItem
        title="Last value label"
        htmlFor={`series-last-value-${seriesId}`}
        actions={
          <Switch
            id={`series-last-value-${seriesId}`}
            checked={editedStyle.lastValueVisible}
            onCheckedChange={(checked) =>
              setStyle(editedSeries.id, {
                lastValueVisible: checked,
              })
            }
          />
        }
      />
      <CardItem
        title="Last value line"
        htmlFor={`series-value-line-${seriesId}`}
        actions={
          <Switch
            id={`series-value-line-${seriesId}`}
            checked={editedStyle.valueLineVisible}
            onCheckedChange={(checked) =>
              setStyle(editedSeries.id, {
                valueLineVisible: checked,
              })
            }
          />
        }
      />
    </div>
  );
}

// Colors follow the renderer; only an explicit choice is saved.
function SeriesColorSetting({
  seriesId,
  label,
  field = "color",
  localStore,
}: {
  seriesId: string;
  label: string;
  field?: keyof Pick<
    SeriesPreferences,
    | "color"
    | "upColor"
    | "downColor"
    | "wickUpColor"
    | "wickDownColor"
    | "borderUpColor"
    | "borderDownColor"
  >;
  localStore: ChartPreferencesStore;
}) {
  const chart = useChart();
  const series = useStore(chart.store, (state) =>
    v2.ChartStateUtils.getSeries(state, seriesId),
  );
  const override = useStore(
    localStore,
    (state) => state.series[seriesId]?.[field],
  );
  if (!series) return null;
  const options = series.options as Record<string, unknown>;
  const color = String(
    override ??
      options[field] ??
      options.lineColor ??
      options.upColor ??
      "#000000",
  );
  const { r, g, b } = Color.toRGB(color);
  return (
    <CardItem
      title={label}
      htmlFor={`series-${field}-${seriesId}`}
      actions={
        <div className="flex items-center gap-2">
          {override !== undefined ? (
            <Button
              variant="ghost"
              size="xs"
              aria-label={
                label === "Color" ? "Reset color" : `Reset ${label} color`
              }
              onClick={() =>
                updateSeriesStyles(localStore, [seriesId], {
                  [field]: undefined,
                })
              }
            >
              Use default
            </Button>
          ) : null}
          <Input
            type="color"
            className="size-8 cursor-pointer p-0.5"
            id={`series-${field}-${seriesId}`}
            value={Color.toHex(r, g, b)}
            onChange={(event) =>
              updateSeriesStyles(localStore, [seriesId], {
                [field]: event.target.value,
              })
            }
          />
        </div>
      }
    />
  );
}

// A part's opacity: the alpha of an `rgba(...)` color, else opaque.
function alphaOf(color: string): number {
  const match = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/.exec(color);
  return match ? Number(match[1]) : 1;
}

/**
 * The parts of the vertical profiles `bindingIds` draw, each with its color:
 * the one drawn now, so a saved choice or the script's default. Choosing a
 * color or an opacity saves it by part title in chart preferences, which
 * restyles the profiles without running anything; "Use default" removes it.
 */
function ProfilePartColors({
  bindingIds,
  localStore,
}: {
  bindingIds: readonly string[];
  localStore: ChartPreferencesStore;
}) {
  const chart = useChart();
  // Parts by binding, in drawing order: segments, then levels; serialized so
  // the selection only changes when a part or its color does.
  const drawn = useStore(chart.store, (state) =>
    JSON.stringify(
      bindingIds.map((bindingId) => {
        const parts = new Map<string, string>();
        for (const object of Object.values(state.objects))
          if (
            object.kind === "vertical-profile" &&
            object.id.startsWith(`${bindingId}:`)
          )
            for (const part of [
              ...object.profile.rows.flatMap((row) => row.segments),
              ...object.profile.levels,
            ])
              if (part.title && !parts.has(part.title))
                parts.set(part.title, part.color);
        return [bindingId, [...parts]] as const;
      }),
    ),
  );
  const saved = useStore(localStore, (state) => state.series);
  const set = (bindingId: string, title: string, color: string | undefined) => {
    const others = Object.fromEntries(
      Object.entries(saved[bindingId]?.partColors ?? {}).filter(
        ([name]) => name !== title,
      ),
    );
    const partColors =
      color === undefined ? others : { ...others, [title]: color };
    updateSeriesStyles(localStore, [bindingId], {
      partColors: Object.keys(partColors).length ? partColors : undefined,
    });
  };
  return (
    <div className="text-sm">
      {(JSON.parse(drawn) as [string, [string, string][]][]).flatMap(
        ([bindingId, parts]) =>
          parts.map(([title, color]) => {
            const { r, g, b } = Color.toRGB(color);
            const alpha = alphaOf(color);
            const id = `profile-part-${bindingId}-${title}`;
            const choose = (hex: string, opacity: number) =>
              set(bindingId, title, Color.withAlpha(hex, opacity));
            return (
              <CardItem
                key={id}
                title={title}
                htmlFor={id}
                actions={
                  <div className="flex items-center gap-2">
                    {saved[bindingId]?.partColors?.[title] !== undefined ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label={`Reset ${title} color`}
                        onClick={() => set(bindingId, title, undefined)}
                      >
                        Use default
                      </Button>
                    ) : null}
                    <Input
                      type="color"
                      className="size-8 cursor-pointer p-0.5"
                      id={id}
                      value={Color.toHex(r, g, b)}
                      onChange={(event) => choose(event.target.value, alpha)}
                    />
                    <input
                      type="range"
                      aria-label={`${title} opacity`}
                      className="w-24 accent-primary"
                      min={0}
                      max={1}
                      step={0.05}
                      value={alpha}
                      onChange={(event) =>
                        choose(Color.toHex(r, g, b), Number(event.target.value))
                      }
                    />
                  </div>
                }
              />
            );
          }),
      )}
    </div>
  );
}
