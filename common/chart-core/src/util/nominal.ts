// Purpose: Nominal/branded type utilities for type-safe identifiers
// Module:  @openchart/chart-core / util

declare const brand: unique symbol;

export type Nominal<T, Brand extends string> = T & { readonly [brand]: Brand };

export function nominal<T, Brand extends string>(value: T): Nominal<T, Brand> {
  return value as Nominal<T, Brand>;
}
