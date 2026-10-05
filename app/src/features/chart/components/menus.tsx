// Purpose: Keep per-chart context menus and style dialogs bound to their original target.
import { Drawing, Series, v2 } from "@openchart/chart-core";
import { getAxis } from "@openchart/chart-core/v2/x-scale";
import { barsSeries } from "@openchart/feed";
import { Schema } from "effect";
import { useContext, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@openchart/app/components/ui/dialog";
import {
  Menu,
  MenuCheckboxItem,
  MenuAnchor,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuSubContent,
} from "@openchart/app/components/ui/menu";
import { Switch } from "@openchart/app/components/ui/form/switch";
import { Input } from "@openchart/app/components/ui/input";
import { CardItem } from "@openchart/app/components/ui/settings/card";
import { DropdownControl } from "@openchart/app/components/ui/settings/dropdown-control";
import type { CellDefinition } from "@openchart/app/features/chart/api/queries";
import {
  getMainSource,
  getSeriesGroup,
} from "@openchart/app/features/chart/utils/resource";
import { ChartAlertContext } from "@openchart/app/features/chart/components/alert-button";
import type { DrawingResource } from "@openchart/app/lib/chart/drawings";
import { useWidgetControls } from "@openchart/app/hooks/use-widget";
import { useChart } from "@openchart/app/hooks/use-chart";
import type { ChartPreferencesStore } from "@openchart/app/lib/chart/preferences";

const lineStyles = ["solid", "dashed", "dotted"].map((value) => ({
  value,
  name: value,
}));
const scaleModes = [
  { value: "normal", name: "Linear" },
  { value: "logarithmic", name: "Logarithmic" },
  { value: "percentage", name: "Percentage" },
  { value: "indexed", name: "Indexed to 100" },
] as const;

function ColorInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      id={id}
      type="color"
      className="size-8 cursor-pointer rounded-md border border-input bg-background p-0.5"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** Menus use this cell's Context even when another cell becomes focused. @example <ChartMenus cell={cell} localStore={localStore} onMove={move} onRemove={remove} /> */
export function ChartMenus({
  cell,
  localStore,
  onMove,
  onRemove,
  disabled = false,
  saveDrawing,
  drawingOnly = false,
}: {
  cell: CellDefinition;
  localStore: ChartPreferencesStore;
  onMove: (id: string, paneId: string | "new") => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
  saveDrawing?: (id: string) => Promise<DrawingResource>;
  drawingOnly?: boolean;
}) {
  const chart = useChart();
  const alerts = useContext(ChartAlertContext);
  const [savingDrawing, setSavingDrawing] = useState(false);
  const seriesMenu = useStore(chart.store, (state) => state.seriesContextMenu);
  const magnetSeriesId = useStore(chart.store, (state) => state.magnetSeriesId);
  const axisMenu = useStore(chart.store, (state) => state.yAxisContextMenu);
  const drawingMenu = useStore(
    chart.store,
    (state) => state.drawings.contextMenu,
  );
  const drawings = useStore(
    chart.store,
    useShallow((state) => v2.ChartStateModel.drawingItems(state)),
  );
  const preferences = useStore(localStore);
  const [editingDrawing, setEditingDrawing] = useState<string>();
  const target = drawingMenu ?? seriesMenu ?? axisMenu;
  const openingDialog = useRef(false);
  const anchor = useMemo(
    () => ({
      current: {
        contextElement: chart.renderer.canvas,
        getBoundingClientRect: () => {
          const canvas = chart.renderer.canvas.getBoundingClientRect();
          return new DOMRect(
            canvas.left + (target?.x ?? 0),
            canvas.top + (target?.y ?? 0),
            0,
            0,
          );
        },
      },
    }),
    [chart, target],
  );
  const currentSeries =
    !drawingOnly && seriesMenu
      ? v2.ChartStateUtils.getSeries(
          chart.store.getState(),
          seriesMenu.seriesId,
        )
      : undefined;
  const group = currentSeries ? getSeriesGroup(cell, currentSeries.id) : [];
  const source = group[0]?.source;
  const indicatorId =
    source?.kind === "indicator" ? source.indicatorId : undefined;
  const ownAxis =
    group.length > 0 &&
    group.every((series) => preferences.series[series.id]?.ownAxis);
  const placeAxis = (ownAxis: boolean, side?: "left" | "right") => {
    if (!currentSeries) return;
    const placementAxisId = `${indicatorId ?? currentSeries.id}:axis`;
    localStore.setState((state) => ({
      series: {
        ...state.series,
        ...Object.fromEntries(
          group.map(({ id }) => [
            id,
            {
              ...state.series[id],
              ownAxis,
            },
          ]),
        ),
      },
      ...(side
        ? {
            axes: {
              ...state.axes,
              [placementAxisId]: { ...state.axes[placementAxisId], side },
            },
          }
        : {}),
    }));
  };
  const axis = axisMenu
    ? v2.ChartStateUtils.getYAxis(chart.store.getState(), axisMenu.axisId)
    : undefined;
  const drawing = drawingMenu
    ? drawings.find((item) => item.id === drawingMenu.id)
    : undefined;
  const state = chart.store.getState();
  const main = v2.ChartStateModel.mainSeries(state);
  const mainAxisId = main && Series.getYAxisId(main);
  const mainAxis = state.config.yAxis.axes.find(
    (axis) => axis.id === mainAxisId,
  );
  const timeAxis = getAxis(state.config.xAxis);
  const series = v2.ChartStateModel.resolvedSeriesValues(state);
  // Drawings use the renderer's active series timeline, even when another series is the main price.
  const drawingSeries =
    series.find((item) => Series.getXAxisId(item) === timeAxis.id) ?? series[0];
  const drawingAlertSupported =
    !!drawing &&
    [
      "trend_line",
      "ray",
      "extended_line",
      "horizontal_line",
      "horizontal_ray",
      "parallel_channel",
      "fib_retracement",
      "fib_channel",
      "freehand",
      "polyline",
      "rectangle",
      "triangle",
      "curved_line",
    ].includes(drawing.type) &&
    drawingSeries?.id === main?.id &&
    cell.panes.some((pane) =>
      pane.series.some(
        (series) => series.role === "main" && series.id === main?.id,
      ),
    ) &&
    mainAxis?.mode === "normal" &&
    timeAxis.mode === "ordinal" &&
    // With the main timeline selected, omitted anchors inherit the drawing's main-price axis.
    drawing.anchors.every(
      (anchor) => (anchor.axisId ?? mainAxisId) === mainAxisId,
    );
  const isMain = currentSeries
    ? cell.panes.some((pane) =>
        pane.series.some(
          (series) => series.id === currentSeries.id && series.role === "main",
        ),
      )
    : false;
  const close = () =>
    chart.mutate((state) => {
      delete state.seriesContextMenu;
      delete state.yAxisContextMenu;
      delete state.drawings.contextMenu;
    });
  const setAxis = (change: Partial<(typeof preferences.axes)[string]>) => {
    if (axisMenu)
      localStore.setState((state) => ({
        axes: {
          ...state.axes,
          [axisMenu.axisId]: { ...state.axes[axisMenu.axisId], ...change },
        },
      }));
  };
  const editDrawing = (id: string, update: (item: Drawing.Item) => void) =>
    chart.mutate((state) => {
      const item = v2.ChartStateModel.drawingItems(state).find(
        (item) => item.id === id,
      );
      if (item) update(item);
    });
  const editedDrawing = drawings.find((item) => item.id === editingDrawing);
  const menuOpen = !!(currentSeries || axis || drawing);
  useWidgetControls(menuOpen || !!editedDrawing);
  return (
    <>
      <Menu
        open={menuOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <MenuAnchor virtualRef={anchor} />
        <MenuContent
          side="bottom"
          align="start"
          sideOffset={0}
          className="w-56"
          aria-label="Chart context menu"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!openingDialog.current) chart.renderer.canvas.focus();
            openingDialog.current = false;
          }}
        >
          {currentSeries ? (
            <>
              <MenuLabel>
                {indicatorId
                  ? "Indicator placement"
                  : String(currentSeries.options.title || currentSeries.type)}
              </MenuLabel>
              {!indicatorId ? (
                <MenuCheckboxItem
                  indicatorPosition="end"
                  checked={magnetSeriesId === currentSeries.id}
                  onCheckedChange={(checked) =>
                    chart.mutate((state) => {
                      state.magnetSeriesId = checked
                        ? currentSeries.id
                        : undefined;
                    })
                  }
                >
                  Magnet
                </MenuCheckboxItem>
              ) : null}
              {indicatorId || currentSeries.type !== "Histogram" ? (
                <MenuItem onSelect={() => placeAxis(!ownAxis)}>
                  {ownAxis ? "Share pane axis" : "Use own axis"}
                </MenuItem>
              ) : null}
              <MenuSub>
                <MenuSubTrigger>Move axis to</MenuSubTrigger>
                <MenuSubContent>
                  {(["left", "right"] as const).map((side) => (
                    <MenuItem key={side} onSelect={() => placeAxis(true, side)}>
                      {side === "left" ? "Left" : "Right"}
                    </MenuItem>
                  ))}
                </MenuSubContent>
              </MenuSub>
              <MenuSub>
                <MenuSubTrigger disabled={disabled}>
                  Move to pane
                </MenuSubTrigger>
                <MenuSubContent>
                  {cell.panes.map((pane, index) => (
                    <MenuItem
                      key={pane.id}
                      onSelect={() => onMove(currentSeries.id, pane.id)}
                    >
                      Pane {index + 1}
                    </MenuItem>
                  ))}
                  <MenuItem
                    disabled={
                      disabled ||
                      cell.panes.length >= v2.ChartStateModel.MAX_PANES
                    }
                    onSelect={() => onMove(currentSeries.id, "new")}
                  >
                    New pane
                  </MenuItem>
                </MenuSubContent>
              </MenuSub>
              {!indicatorId ? (
                <>
                  <MenuItem
                    disabled={disabled || isMain}
                    onSelect={() => onRemove(currentSeries.id)}
                  >
                    Remove series
                  </MenuItem>
                  <MenuCheckboxItem
                    indicatorPosition="end"
                    checked={preferences.comparison}
                    onCheckedChange={(checked) =>
                      localStore.setState({ comparison: checked })
                    }
                  >
                    Normalize comparisons
                  </MenuCheckboxItem>
                  {preferences.comparison &&
                  preferences.comparisonAnchor !== null ? (
                    <MenuItem
                      onSelect={() => {
                        chart.mutate((state) => {
                          if (state.comparison) {
                            const axis = v2.ChartStateUtils.getYAxis(
                              state,
                              state.comparison.axisId,
                            );
                            if (axis) delete axis.modeAnchor;
                            state.comparison.mainBaselineTime = undefined;
                          }
                        });
                        localStore.setState({ comparisonAnchor: null });
                      }}
                    >
                      Reset baseline (
                      {new Date(
                        preferences.comparisonAnchor,
                      ).toLocaleDateString()}
                      )
                    </MenuItem>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          {axis ? (
            <>
              <MenuLabel>Price axis</MenuLabel>
              <MenuCheckboxItem
                indicatorPosition="end"
                checked={axis.autoScale}
                onCheckedChange={(checked) => setAxis({ autoScale: checked })}
              >
                Auto scale
              </MenuCheckboxItem>
              <MenuSeparator />
              <MenuRadioGroup
                aria-label="Scale type"
                value={axis.mode}
                onValueChange={(value) =>
                  setAxis({ mode: value as typeof axis.mode })
                }
              >
                {scaleModes.map((mode) => (
                  <MenuRadioItem
                    key={mode.value}
                    value={mode.value}
                    indicatorPosition="end"
                    disabled={axis.lockZero}
                  >
                    {mode.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <MenuCheckboxItem
                indicatorPosition="end"
                checked={axis.invertScale}
                onCheckedChange={(checked) => setAxis({ invertScale: checked })}
              >
                Invert scale
              </MenuCheckboxItem>
              <MenuSeparator />
              <MenuItem
                onSelect={() =>
                  setAxis({ side: axis.side === "left" ? "right" : "left" })
                }
              >
                Move axis {axis.side === "left" ? "right" : "left"}
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  setAxis({ autoScale: true });
                  chart.mutate((state) =>
                    v2.ChartStateUtils.resetYAxisExtent(state, axis.id),
                  );
                }}
              >
                Reset axis
              </MenuItem>
            </>
          ) : null}
          {drawing ? (
            <>
              <MenuLabel>
                {drawing.type === "annotation"
                  ? drawing.title
                  : (drawing.name ?? drawing.type.replaceAll("_", " "))}
              </MenuLabel>
              {!drawingOnly && alerts?.createDrawing && saveDrawing ? (
                <MenuItem
                  disabled={
                    !drawingAlertSupported || savingDrawing || alerts.pending
                  }
                  onSelect={() => {
                    openingDialog.current = true;
                    setSavingDrawing(true);
                    const inputs = barsSeries(getMainSource(cell), cell);
                    void saveDrawing(drawing.id)
                      .then((saved) => {
                        alerts.createDrawing?.({
                          drawingId: saved.id,
                          inputs,
                          name:
                            saved.data.type === "annotation"
                              ? saved.data.title
                              : (saved.data.name ??
                                saved.data.type.replaceAll("_", " ")),
                          type: saved.data.type,
                        });
                      })
                      .catch(() => chart.renderer.canvas.focus())
                      .finally(() => setSavingDrawing(false));
                  }}
                >
                  Create alert…
                </MenuItem>
              ) : null}
              <MenuItem
                disabled={drawing.type === "annotation"}
                onSelect={() => {
                  openingDialog.current = true;
                  setEditingDrawing(drawing.id);
                }}
              >
                Drawing style…
              </MenuItem>
              <MenuItem
                onSelect={() =>
                  editDrawing(drawing.id, (item) => {
                    item.locked = !item.locked;
                  })
                }
              >
                {drawing.locked ? "Unlock drawing" : "Lock drawing"}
              </MenuItem>
              {!drawingOnly ? (
                <>
                  <MenuItem
                    onSelect={() =>
                      editDrawing(drawing.id, (item) => {
                        item.hidden = !item.hidden;
                      })
                    }
                  >
                    {drawing.hidden ? "Show drawing" : "Hide drawing"}
                  </MenuItem>
                  <MenuItem
                    variant="destructive"
                    onSelect={() =>
                      chart.mutate((state) =>
                        v2.ChartStateModel.removeDrawingObject(
                          state,
                          drawing.id,
                        ),
                      )
                    }
                  >
                    Delete drawing
                  </MenuItem>
                </>
              ) : null}
            </>
          ) : null}
        </MenuContent>
      </Menu>
      {editedDrawing && editedDrawing.type !== "annotation" ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setEditingDrawing(undefined);
          }}
        >
          <DialogContent
            className="sm:max-w-md"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              chart.renderer.canvas.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>Drawing style</DialogTitle>
              <DialogDescription>
                Changes apply to the selected drawing in this chart.
              </DialogDescription>
            </DialogHeader>
            <div className="text-sm">
              <CardItem
                title="Name"
                htmlFor="drawing-name"
                actions={
                  <Input
                    id="drawing-name"
                    className="h-8 w-44"
                    value={editedDrawing.name ?? ""}
                    onChange={(event) =>
                      editDrawing(editedDrawing.id, (item) => {
                        if (item.type !== "annotation")
                          item.name = event.target.value;
                      })
                    }
                  />
                }
              />
              <CardItem
                title="Color"
                htmlFor="drawing-color"
                actions={
                  <ColorInput
                    id="drawing-color"
                    value={editedDrawing.style.lineColor}
                    onChange={(color) =>
                      editDrawing(editedDrawing.id, (item) => {
                        item.style.lineColor = color;
                        item.style.textColor = color;
                      })
                    }
                  />
                }
              />
              {editedDrawing.type === "text" ? (
                <CardItem
                  title="Font size"
                  htmlFor="drawing-font-size"
                  actions={
                    <Input
                      id="drawing-font-size"
                      type="number"
                      className="h-8 w-20"
                      min={8}
                      max={96}
                      value={editedDrawing.style.fontSize}
                      onChange={(event) => {
                        const size = Number(event.target.value);
                        if (size >= 8 && size <= 96)
                          editDrawing(editedDrawing.id, (item) => {
                            item.style.fontSize = size;
                          });
                      }}
                    />
                  }
                />
              ) : (
                <>
                  <CardItem
                    title="Line width"
                    htmlFor="drawing-line-width"
                    actions={
                      <Input
                        id="drawing-line-width"
                        type="number"
                        className="h-8 w-20"
                        min={1}
                        max={10}
                        value={editedDrawing.style.lineWidth}
                        onChange={(event) => {
                          const width = Number(event.target.value);
                          if (width >= 1 && width <= 10)
                            editDrawing(editedDrawing.id, (item) => {
                              item.style.lineWidth = width;
                            });
                        }}
                      />
                    }
                  />
                  <CardItem
                    title="Line style"
                    htmlFor="drawing-line-style"
                    actions={
                      <div className="w-32">
                        <DropdownControl
                          id="drawing-line-style"
                          value={editedDrawing.style.lineStyle}
                          options={lineStyles}
                          onChange={(value) =>
                            editDrawing(editedDrawing.id, (item) => {
                              item.style.lineStyle = Schema.decodeUnknownSync(
                                Drawing.LineStyle,
                              )(String(value));
                            })
                          }
                        />
                      </div>
                    }
                  />
                </>
              )}
              <CardItem
                title="Opacity"
                htmlFor="drawing-opacity"
                actions={
                  <input
                    id="drawing-opacity"
                    type="range"
                    className="w-40 accent-primary"
                    min={0}
                    max={1}
                    step={0.05}
                    value={editedDrawing.style.opacity}
                    onChange={(event) =>
                      editDrawing(editedDrawing.id, (item) => {
                        item.style.opacity = Number(event.target.value);
                      })
                    }
                  />
                }
              />
              {["rectangle", "ellipse", "circle", "triangle"].includes(
                editedDrawing.type,
              ) ? (
                <CardItem
                  title="Fill shape"
                  htmlFor="drawing-fill"
                  actions={
                    <Switch
                      id="drawing-fill"
                      checked={editedDrawing.style.fillColor !== undefined}
                      onCheckedChange={(checked) =>
                        editDrawing(editedDrawing.id, (item) => {
                          item.style.fillColor = checked
                            ? item.style.lineColor
                            : undefined;
                        })
                      }
                    />
                  }
                />
              ) : null}
              {editedDrawing.type === "text" ? (
                <CardItem
                  title="Text"
                  htmlFor="drawing-text"
                  actions={
                    <Input
                      id="drawing-text"
                      className="h-8 w-44"
                      value={editedDrawing.text}
                      onChange={(event) =>
                        editDrawing(editedDrawing.id, (item) => {
                          if (item.type === "text")
                            item.text = event.target.value;
                        })
                      }
                    />
                  }
                />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
