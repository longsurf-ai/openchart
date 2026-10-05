// Purpose: Register chart Indicators on the existing Resource surfaces.
import { defineResource } from "@openchart/server/lib/resource/definition";

import { IndicatorEntity } from "./entity";
import { indicatorStore } from "./store";
import { reload } from "./transitions/reload";

export { IndicatorEntity, IndicatorId } from "./entity";

/** Independent Indicator CRUD, revisions, pagination and events. @example resources.indicator.list({ filter: { chartId } }); */
export const indicatorResource = defineResource({
  name: "indicator",
  entity: IndicatorEntity,
  store: indicatorStore,
  transitions: { reload },
});

/** Complete Indicator returned by Resource reads and writes. */
export type Indicator = typeof indicatorResource.entity.Type;
