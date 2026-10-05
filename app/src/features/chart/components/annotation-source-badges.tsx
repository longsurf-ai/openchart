// Purpose: Derive optional website icons from source links into runtime decoration only.
import { v2, type Drawing } from "@openchart/chart-core";
import { preloadAnnotationSourceBadgeImages } from "@openchart/chart-core/annotation";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useChart, useChartState } from "@openchart/app/hooks/use-chart";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

function hostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Share Query-cached icons with canvas and expanded cards without modifying Drawings.
 * @example <AnnotationSourceBadges transport={transport} />
 */
export function AnnotationSourceBadges({
  transport,
}: {
  transport: AppTransport;
}) {
  const chart = useChart();
  const annotations = useChartState(
    useShallow((state) =>
      v2.ChartStateModel.drawingItems(state).filter(
        (item): item is Drawing.AnnotationItem =>
          item.type === "annotation" && !item.hidden,
      ),
    ),
  );
  const hosts = [
    ...new Set(
      annotations.flatMap((item) =>
        item.sources.map((source) => hostname(source.url)),
      ),
    ),
  ].filter(Boolean);
  const icons = useQueries({
    queries: hosts.map((host) => ({
      queryKey: ["favicon", host],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        transport.rpc.favicon.get
          .query({ hostname: host }, { signal })
          .catch(() => null),
      staleTime: Infinity,
    })),
    combine: (results) =>
      Object.fromEntries(
        hosts.map((host, index) => [host, results[index]?.data]),
      ),
  });
  const badges = useMemo(
    () =>
      Object.fromEntries(
        annotations.map((item) => [
          item.id,
          item.sources.map((source) => ({
            id: source.url,
            label: source.title,
            logoUrl: icons[hostname(source.url)] ?? undefined,
          })),
        ]),
      ),
    [annotations, icons],
  );

  useEffect(() => {
    let active = true;
    chart.mutate((state) => {
      state.sourceBadgesByAnnotationId = {
        ...state.sourceBadgesByAnnotationId,
        ...badges,
      };
    }, "light");
    preloadAnnotationSourceBadgeImages(Object.values(badges).flat(), () => {
      if (active) chart.renderer.render("light");
    });
    return () => {
      active = false;
      chart.mutate((state) => {
        for (const id of Object.keys(badges))
          delete state.sourceBadgesByAnnotationId?.[id];
      }, "light");
    };
  }, [chart, badges]);
  return null;
}
