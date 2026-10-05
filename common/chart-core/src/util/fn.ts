// Purpose: Zod-validated function wrapper that parses input against a schema and attaches the schema to the result
// Module:  @openchart/chart-core / util

import { z } from "zod";

export function fn<T extends z.ZodType, Result>(
  schema: T,
  cb: (input: z.infer<T>, raw: unknown) => Result,
): ((input: z.infer<T>) => Result) & { schema: T } {
  const result = (input: z.infer<T>) => {
    const parsed = schema.parse(input);
    return cb(parsed, input);
  };
  result.schema = schema;
  return result as typeof result & { schema: T };
}
