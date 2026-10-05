// Purpose: Resolve a symbol, company name or domain to one canonical logo.
import { Schema } from "effect";

/** A nonblank identifier; matching and aliases belong to the backend. */
export const LogoRequest = Schema.Struct({
  identifier: Schema.String.check(
    Schema.isPattern(/\S/),
    Schema.isMaxLength(256),
  ),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type LogoRequest = typeof LogoRequest.Type;
/** Null means no unique, confident match. Service failures stay errors. */
export const LogoResult = Schema.NullOr(
  Schema.Struct({
    id: Schema.NonEmptyString,
    url: Schema.String.check(
      Schema.makeFilter((value) => URL.canParse(value), {
        message: "Invalid logo URL",
      }),
    ),
  }),
);
export type LogoResult = typeof LogoResult.Type;
