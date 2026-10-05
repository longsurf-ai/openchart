// Purpose: Raster occupancy primitives for chart annotation placement masks
// Module:  @openchart/chart-core / annotation

import type { Rect } from "@openchart/chart-core/span";

export type RasterPoint = { x: number; y: number };

export type MaskSpan = {
  y: number;
  x1: number;
  x2: number;
};

export type CandidateMask = {
  bounds: Rect;
  spans: readonly MaskSpan[];
};

export type RasterScale = {
  ratio: number;
  width: number;
  height: number;
  area: Rect;
  x(value: number): number;
  y(value: number): number;
};

const WORD_SHIFT = 5;
const WORD_MASK = 31;
const WORD_SIZE = 32;
const RIGHT0 = new Uint32Array(WORD_SIZE + 1);
const RIGHT1 = new Uint32Array(WORD_SIZE + 1);

RIGHT1[0] = 0;
RIGHT0[0] = ~RIGHT1[0];
for (let i = 1; i <= WORD_SIZE; i++) {
  RIGHT1[i] = (RIGHT1[i - 1]! << 1) | 1;
  RIGHT0[i] = ~RIGHT1[i]!;
}

export function createRasterScale(area: Rect): RasterScale {
  const budget = 1_200_000;
  const ratio = Math.max(1, Math.sqrt((area.width * area.height) / budget));
  const width = Math.max(1, Math.ceil(area.width / ratio));
  const height = Math.max(1, Math.ceil(area.height / ratio));
  return {
    ratio,
    width,
    height,
    area,
    x(value: number) {
      return Math.floor((value - area.x) / ratio);
    },
    y(value: number) {
      return Math.floor((value - area.y) / ratio);
    },
  };
}

export type OccupancyBitmap = ReturnType<typeof createOccupancyBitmap>;

export function createOccupancyBitmap(scale: RasterScale) {
  const words = new Uint32Array(
    Math.ceil((scale.width * scale.height) / WORD_SIZE),
  );

  const visit = (
    span: MaskSpan,
    fn: (
      start: number,
      end: number,
      startWord: number,
      endWord: number,
    ) => void,
  ) => {
    if (span.y < 0 || span.y >= scale.height) return;
    if (span.x2 < 0 || span.x1 >= scale.width) return;
    const y = span.y;
    const x1 = Math.max(0, Math.min(scale.width - 1, span.x1));
    const x2 = Math.max(0, Math.min(scale.width - 1, span.x2));
    if (x2 < x1) return;
    const start = y * scale.width + x1;
    const end = y * scale.width + x2;
    fn(start, end, start >>> WORD_SHIFT, end >>> WORD_SHIFT);
  };

  return {
    hasAny(mask: CandidateMask): boolean {
      for (const span of mask.spans) {
        let hit = false;
        visit(span, (start, end, startWord, endWord) => {
          if (startWord === endWord) {
            hit =
              (words[startWord]! &
                RIGHT0[start & WORD_MASK]! &
                RIGHT1[(end & WORD_MASK) + 1]!) !==
              0;
            return;
          }
          if ((words[startWord]! & RIGHT0[start & WORD_MASK]!) !== 0) {
            hit = true;
            return;
          }
          if ((words[endWord]! & RIGHT1[(end & WORD_MASK) + 1]!) !== 0) {
            hit = true;
            return;
          }
          for (let word = startWord + 1; word < endWord; word++) {
            if (words[word] !== 0) {
              hit = true;
              return;
            }
          }
        });
        if (hit) return true;
      }
      return false;
    },

    overlapCount(mask: CandidateMask): number {
      let count = 0;
      for (const span of mask.spans) {
        visit(span, (start, end, startWord, endWord) => {
          if (startWord === endWord) {
            count += popcount32(
              words[startWord]! &
                RIGHT0[start & WORD_MASK]! &
                RIGHT1[(end & WORD_MASK) + 1]!,
            );
            return;
          }
          count += popcount32(words[startWord]! & RIGHT0[start & WORD_MASK]!);
          count += popcount32(words[endWord]! & RIGHT1[(end & WORD_MASK) + 1]!);
          for (let word = startWord + 1; word < endWord; word++) {
            count += popcount32(words[word]!);
          }
        });
      }
      return count;
    },

    set(mask: CandidateMask) {
      for (const span of mask.spans) {
        visit(span, (start, end, startWord, endWord) => {
          if (startWord === endWord) {
            words[startWord] =
              words[startWord]! |
              (RIGHT0[start & WORD_MASK]! & RIGHT1[(end & WORD_MASK) + 1]!);
            return;
          }
          words[startWord] = words[startWord]! | RIGHT0[start & WORD_MASK]!;
          words[endWord] = words[endWord]! | RIGHT1[(end & WORD_MASK) + 1]!;
          for (let word = startWord + 1; word < endWord; word++) {
            words[word] = 0xffffffff;
          }
        });
      }
    },

    spans(): MaskSpan[] {
      const spans: MaskSpan[] = [];
      for (let y = 0; y < scale.height; y++) {
        let start: number | null = null;
        for (let x = 0; x < scale.width; x++) {
          const index = y * scale.width + x;
          const occupied =
            (words[index >>> WORD_SHIFT]! & (1 << (index & WORD_MASK))) !== 0;
          if (occupied && start === null) {
            start = x;
            continue;
          }
          if (!occupied && start !== null) {
            spans.push({ y, x1: start, x2: x - 1 });
            start = null;
          }
        }
        if (start !== null) spans.push({ y, x1: start, x2: scale.width - 1 });
      }
      return spans;
    },
  };
}

export function combineMasks(masks: CandidateMask[]): CandidateMask {
  const spans = normalizeSpans(masks.flatMap((mask) => mask.spans));
  const bounds = masks.reduce(
    (result, mask) => unionRect(result, mask.bounds),
    masks[0]?.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
  );
  return { bounds, spans };
}

export function rectMask(
  scale: RasterScale,
  rect: Rect,
  padding = 0,
): CandidateMask {
  const x1 = scale.x(rect.x - padding);
  const x2 = scale.x(rect.x + rect.width + padding);
  const y1 = scale.y(rect.y - padding);
  const y2 = scale.y(rect.y + rect.height + padding);
  const spans: MaskSpan[] = [];
  for (let y = y1; y <= y2; y++) spans.push({ y, x1, x2 });
  return {
    bounds: {
      x: rect.x - padding,
      y: rect.y - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    },
    spans: normalizeSpans(spans),
  };
}

export function lineMask(input: {
  scale: RasterScale;
  from: RasterPoint;
  to: RasterPoint;
  radius: number;
}): CandidateMask {
  const x1 = input.scale.x(input.from.x);
  const y1 = input.scale.y(input.from.y);
  const x2 = input.scale.x(input.to.x);
  const y2 = input.scale.y(input.to.y);
  const r = Math.max(1, Math.ceil(input.radius / input.scale.ratio));
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
  const spans: MaskSpan[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x1 + (x2 - x1) * t);
    const y = Math.round(y1 + (y2 - y1) * t);
    spans.push({ y, x1: x - r, x2: x + r });
  }
  return {
    bounds: {
      x: Math.min(input.from.x, input.to.x) - input.radius,
      y: Math.min(input.from.y, input.to.y) - input.radius,
      width: Math.abs(input.from.x - input.to.x) + input.radius * 2,
      height: Math.abs(input.from.y - input.to.y) + input.radius * 2,
    },
    spans: normalizeSpans(spans),
  };
}

export function circleMask(input: {
  scale: RasterScale;
  center: RasterPoint;
  radius: number;
}): CandidateMask {
  const cx = input.scale.x(input.center.x);
  const cy = input.scale.y(input.center.y);
  const r = Math.max(1, Math.ceil(input.radius / input.scale.ratio));
  const spans: MaskSpan[] = [];
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    spans.push({ y: cy + dy, x1: cx - dx, x2: cx + dx });
  }
  return {
    bounds: {
      x: input.center.x - input.radius,
      y: input.center.y - input.radius,
      width: input.radius * 2,
      height: input.radius * 2,
    },
    spans: normalizeSpans(spans),
  };
}

function normalizeSpans(spans: MaskSpan[]): MaskSpan[] {
  const rows = new Map<number, MaskSpan[]>();
  for (const span of spans) {
    const list = rows.get(span.y) ?? [];
    list.push(span);
    rows.set(span.y, list);
  }
  const result: MaskSpan[] = [];
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const list = rows.get(y)!.sort((a, b) => a.x1 - b.x1);
    let current: MaskSpan | null = null;
    for (const span of list) {
      if (!current) {
        current = { ...span };
        continue;
      }
      if (span.x1 <= current.x2 + 1) {
        current.x2 = Math.max(current.x2, span.x2);
        continue;
      }
      result.push(current);
      current = { ...span };
    }
    if (current) result.push(current);
  }
  return result;
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function popcount32(value: number): number {
  value = value - ((value >>> 1) & 0x55555555);
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
