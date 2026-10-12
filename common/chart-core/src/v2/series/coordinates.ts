// Purpose: Share raw-value conversions through the last painted series scale.
import { CoordSys } from "@openchart/chart-core/coord";

type ValueTransform = { value: (raw: number) => number } | undefined;

/** Invert a painted scale and its affine comparison transform without mutating either.
 * Returns undefined for degenerate/non-finite values; owns no resources.
 * @example const price = rawValueAtY(scale, transform, pointerY);
 */
export function rawValueAtY(
  scale: CoordSys.Scale,
  transform: ValueTransform,
  y: number,
): number | undefined {
  const displayed = CoordSys.toValue(y, scale);
  const offset = transform?.value(0) ?? 0;
  const slope = transform ? transform.value(1) - offset : 1;
  const value = (displayed - offset) / slope;
  return Number.isFinite(value) ? value : undefined;
}

/** Project a raw value through the painted comparison and linear/log scale.
 * Returns undefined for invalid log inputs or non-finite output; owns no resources.
 * @example const y = yAtRawValue(scale, transform, price);
 */
export function yAtRawValue(
  scale: CoordSys.Scale,
  transform: ValueTransform,
  value: number,
): number | undefined {
  const displayed = transform?.value(value) ?? value;
  if (scale.mode === "log" && displayed <= 0) return undefined;
  const y = CoordSys.toPixel(displayed, scale);
  return Number.isFinite(y) ? y : undefined;
}
