// Purpose: Discovers application-owned schemas, excluding provider-owned local datasets.

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: [
    "./agent/**/schema.ts",
    "./access/credential/schema.ts",
    "./resources/**/schema.ts",
  ],
  out: "./db/migration",
  dbCredentials: {
    url: ":memory:",
  },
});
