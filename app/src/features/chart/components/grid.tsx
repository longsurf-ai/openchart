// Purpose: Lay out independent chart children with CSS Grid and commit only finished divider gestures.
import { useQuery } from "@tanstack/react-query";
import {
  Children,
  isValidElement,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "zustand";

import {
  chartDetail,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import { createLayoutStore } from "@openchart/app/features/chart/stores/layout";
import {
  useChartLinks,
  type CrosshairLink,
} from "@openchart/app/hooks/use-chart-links";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";

import {
  fitGridTracks,
  getGridPreset,
  type GridPreset,
  type GridRatios,
} from "@openchart/app/features/chart/utils/grid-layout";
import { cn } from "@openchart/app/utils/cn";

import { SharedDividers } from "./shared-dividers";
import { ChartCell } from "./cell";
import { GridPresetMenu } from "./layout-menu";
import { ResourceNotice } from "./resource-notice";
import "./grid.css";

const noLinks: readonly CrosshairLink[] = [];
const selectGrid = (resource: ChartResource) => ({
  preset: resource.preset,
  cellIds: resource.cells.map((cell) => cell.id),
  links: resource.links,
});

/** Read grid membership locally and keep display ratios separate from its Resource. @example <ChartGrid /> */
export function ChartGrid() {
  const { chartId, transport, mounted } = useChartGrid();
  const query = useQuery({
    ...chartDetail(transport, chartId),
    select: selectGrid,
  });
  const [layoutStore] = useState(() => createLayoutStore(chartId));
  const ratios = useStore(layoutStore, (state) => state.ratios);
  const charts = useMemo(
    () => new Map([...mounted].map(([id, handle]) => [id, handle.chart])),
    [mounted],
  );
  useChartLinks(charts, query.data?.links ?? noLinks);
  if (!query.data)
    return query.isPending ? (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading charts…
      </p>
    ) : (
      <ResourceNotice
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  const { preset, cellIds } = query.data;
  const visibleIds = cellIds.slice(0, getGridPreset(preset).capacity);
  return (
    <>
      <GridLayout
        preset={preset}
        ratios={ratios[preset]}
        onRatiosChange={(value) =>
          layoutStore.setState((state) => ({
            ratios: { ...state.ratios, [preset]: value },
          }))
        }
      >
        {visibleIds.map((cellId) => (
          <ChartCell
            key={cellId}
            cellId={cellId}
            multiple={visibleIds.length > 1}
          />
        ))}
      </GridLayout>
      {!cellIds.length ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">This layout is empty.</p>
          <GridPresetMenu empty />
        </div>
      ) : null}
      {query.error ? (
        <div className="absolute bottom-2 left-2 right-2 z-[6]">
          <ResourceNotice
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : null}
    </>
  );
}

/** Layout owns geometry and drag previews; ChartGrid supplies membership. */
interface GridLayoutProps {
  readonly preset: GridPreset;
  readonly ratios?: GridRatios;
  readonly onRatiosChange: (ratios: GridRatios) => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly minCellWidth?: number;
  readonly minCellHeight?: number;
}

/** Resize tracks without remounting existing charts or involving their data subscriptions. */
function GridLayout({
  preset,
  ratios,
  onRatiosChange,
  children,
  className,
  minCellWidth = 180,
  minCellHeight = 120,
}: GridLayoutProps) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [preview, setPreview] = useState<{
    preset: GridPreset;
    ratios: GridRatios;
  } | null>(null);
  const layout = getGridPreset(preset);
  const selected = preview?.preset === preset ? preview.ratios : ratios;
  const fitted: GridRatios = {
    columns: fitGridTracks(
      selected?.columns,
      layout.columns,
      size.width,
      minCellWidth,
    ),
    rows: fitGridTracks(
      selected?.rows,
      layout.rows,
      size.height,
      minCellHeight,
    ),
  };
  const visible = Children.toArray(children).slice(0, layout.capacity);

  useLayoutEffect(() => {
    const element = container.current!;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={container}
      className={cn("chart-grid", className)}
      data-chart-grid={preset}
      style={{
        gridTemplateColumns: fitted.columns
          .map((value) => `minmax(0, ${value}fr)`)
          .join(" "),
        gridTemplateRows: fitted.rows
          .map((value) => `minmax(0, ${value}fr)`)
          .join(" "),
      }}
    >
      {visible.map((child, index) => (
        <div
          key={isValidElement(child) ? child.key : index}
          className="chart-grid-slot"
          data-grid-slot={index}
          style={{
            gridArea: `${Math.floor(index / layout.columns) + 1} / ${(index % layout.columns) + 1}`,
          }}
        >
          {child}
        </div>
      ))}
      <SharedDividers
        key={preset}
        ratios={fitted}
        container={container}
        minCellWidth={minCellWidth}
        minCellHeight={minCellHeight}
        onPreview={(next) => setPreview(next ? { preset, ratios: next } : null)}
        onCommit={onRatiosChange}
      />
    </div>
  );
}
