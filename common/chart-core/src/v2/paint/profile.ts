// Purpose: Lightweight render profiling primitives for the v2 repaint pipeline
// Module:  @openchart/chart-core / v2 / paint

export type RenderProfileMetadataValue =
  string | number | boolean | null | undefined;

export type RenderProfileMetadata = Record<string, RenderProfileMetadataValue>;

export type RenderProfileStage = {
  name: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  metadata?: RenderProfileMetadata;
};

export type RenderProfileEvent = {
  chartId: string;
  level: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  stages: RenderProfileStage[];
};

export type RenderProfileFrame = {
  readonly stages: RenderProfileStage[];
  time<T>(name: string, action: () => T, metadata?: RenderProfileMetadata): T;
};

export function createRenderProfileFrame(
  now: () => number,
): RenderProfileFrame {
  const stages: RenderProfileStage[] = [];

  return {
    stages,
    time<T>(
      name: string,
      action: () => T,
      metadata?: RenderProfileMetadata,
    ): T {
      const startedAt = now();
      try {
        return action();
      } finally {
        const endedAt = now();
        stages.push({
          name,
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          ...(metadata ? { metadata } : {}),
        });
      }
    },
  };
}
