// Purpose: Keep the Agent's Tea guide decodable and in step with the tools' example config.
import { readFileSync } from "node:fs";
import { Schema } from "effect";
import { expect, test } from "vitest";
import { alertRuleResource } from "@openchart/server/resources/alert-rule";
import * as Tea from "@openchart/tea";
import { teaConfigExample } from "./tea-shared";

// The guide the Agent reads as openchart/tea.md.
const guide = readFileSync(
  new URL("../../../../docs/agent/tea.md", import.meta.url),
  "utf8",
);

test("the Tea guide's JSON examples decode with the real schemas and match the tools' example", () => {
  // In order: the config, Samples rows, and a save_alert_rule value.
  const [config, rows, value] = [
    ...guide.matchAll(/^```json\n([\s\S]*?)^```$/gm),
  ].map(([, json]) => JSON.parse(json!) as unknown);
  expect(config).toEqual(teaConfigExample);
  Schema.decodeUnknownSync(Tea.NodeConfig)(config);
  Schema.decodeUnknownSync(Tea.NodeConfig)({
    ...teaConfigExample,
    inputs: {
      bars: { ...teaConfigExample.inputs.bars, _tag: "Samples", rows },
    },
  });
  Schema.decodeUnknownSync(alertRuleResource.transitionDefinitions.save.input)({
    value,
  });
  expect(value).toMatchObject({ alertable: { config: teaConfigExample } });
});
