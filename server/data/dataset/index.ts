// Purpose: Server-owned Dataset declarations, operation contracts and ready access.
export * from "./definition";
export { k } from "./key";
export type { KeyKind, KeySchema } from "./key";
export { list as listDefinitions } from "./registry";
export { DatasetError, DatasetFailure, DatasetReason } from "./errors";
export * as DatasetReasons from "./reasons";
export { makeDataset } from "./dataset";
export type { Dataset, ProviderFor } from "./dataset";
