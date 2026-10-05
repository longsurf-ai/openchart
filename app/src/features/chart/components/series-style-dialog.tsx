// Purpose: Share the existing series style dialog between legends and canvas menus.
import { v2 } from "@openchart/chart-core";
import { Color } from "@openchart/chart-core/util";
import type { ReactNode } from "react";
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

/** Edit one captured display using its existing persisted preferences. @example <SeriesStyleDialog seriesId={id} localStore={preferences} onClose={close} /> */
export function SeriesStyleDialog({
  seriesId,
  selection,
  inputs,
  profileIds = [],
  localStore,
  onClose,
}: {
  seriesId?: string;
  inputs?: ReactNode;
  /** Bindings that draw vertical profiles; Style lists their parts' colors. */
  profileIds?: readonly string[];
  selection?: {
    options: { value: string; name: string }[];
    onChange: (id: string) => void;
  };
  localStore: ChartPreferencesStore;
  onClose: () => void;
}) {
  const chart = useChart();
  const editedSeries = useStore(chart.store, (state) =>
    seriesId ? v2.ChartStateUtils.getSeries(state, seriesId) : undefined,
  );
  const saved = useStore(localStore, (state) =>
    seriesId ? state.series[seriesId] : undefined,
  );
  useWidgetControls(true);
  if (!editedSeries && !inputs && !profileIds.length) return null;
  const editedStyle = {
    ...defaultSeriesPreferences,
    ...editedSeries?.options,
    ...saved,
    type: (saved?.type ??
      editedSeries?.type ??
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
  const parts = profileIds.length ? (
    <ProfilePartColors bindingIds={profileIds} localStore={localStore} />
  ) : null;
  const style = editedSeries ? (
    <div className="text-sm">
      {selection?.options.map((output) => (
        <SeriesColorSetting
          key={output.value}
          seriesId={output.value}
          label={output.name}
          localStore={localStore}
        />
      ))}
      {selection ? (
        <CardItem
          title="Output"
          htmlFor="series-output"
          actions={
            <div className="w-40">
              <DropdownControl
                id="series-output"
                value={editedSeries.id}
                options={selection.options}
                onChange={(value) => selection.onChange(String(value))}
              />
            </div>
          }
        />
      ) : null}
      {editedSeries.type !== "Histogram" ? (
        <CardItem
          title="Type"
          htmlFor="series-type"
          actions={
            <div className="w-40">
              <DropdownControl
                id="series-type"
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
      {!selection ? (
        <SeriesColorSetting
          seriesId={editedSeries.id}
          label="Color"
          localStore={localStore}
        />
      ) : null}
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
              htmlFor={`series-${field}`}
              actions={
                <Switch
                  id={`series-${field}`}
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
            htmlFor="series-line-width"
            actions={
              <Input
                id="series-line-width"
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
            htmlFor="series-line-style"
            actions={
              <div className="w-32">
                <DropdownControl
                  id="series-line-style"
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
        htmlFor="series-last-value"
        actions={
          <Switch
            id="series-last-value"
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
        htmlFor="series-value-line"
        actions={
          <Switch
            id="series-value-line"
            checked={editedStyle.valueLineVisible}
            onCheckedChange={(checked) =>
              setStyle(editedSeries.id, {
                valueLineVisible: checked,
              })
            }
          />
        }
      />
      {parts}
    </div>
  ) : (
    parts
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          chart.renderer.canvas.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Series settings</DialogTitle>
          <DialogDescription>
            {selection
              ? "Set each output’s color; select an output below for its other style settings."
              : "Changes apply to this series in this chart."}
          </DialogDescription>
        </DialogHeader>
        {inputs ? (
          <Tabs defaultValue="inputs">
            <TabsList aria-label="Series settings sections">
              <TabsTrigger value="inputs">Inputs</TabsTrigger>
              <TabsTrigger value="style" disabled={!editedSeries && !parts}>
                Style
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

// Every output reads the same effective options as its renderer; only an explicit choice is saved.
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
  const id = `series-${field}-${seriesId}`;
  return (
    <CardItem
      title={label}
      htmlFor={id}
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
            id={id}
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
