// Purpose: Verify custom widgets keep kinds unique, revise from their own file and serve runnable code.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { router } from "@openchart/server";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import { ConfigProvider } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";

let home: string;
let runtime: ReturnType<typeof makeRuntime>;
let caller: ReturnType<typeof router.createCaller>;

beforeEach(async () => {
  home = temporaryHome();
  runtime = makeRuntime({
    home,
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  await runtime.context();
  caller = router.createCaller({ runtime });
  await mkdir(widgets(), { recursive: true });
  await copyFile(
    new URL("../../../docs/agent/price-chart.widget.tsx", import.meta.url),
    path.join(widgets(), "price-chart.widget.tsx"),
  );
});

afterEach(async () => {
  await runtime.dispose();
});

const widgets = () => path.join(home, "workspaces/default/widgets");
const template = "widgets/price-chart.widget.tsx";

async function saved(file: string, edit: (text: string) => string) {
  const text = await readFile(
    path.join(widgets(), "price-chart.widget.tsx"),
    "utf8",
  );
  await writeFile(path.join(widgets(), file), edit(text));
  return `widgets/${file}`;
}

test("saves the example, ignores unchanged saves and revises from its own file", async () => {
  const workspaceId = await caller.resources.workspace.getDefault();
  const created = await caller.resources.custom_widget.save({
    workspaceId,
    path: template,
  });
  expect(created).toMatchObject({
    kind: "price-chart",
    title: "Price chart",
    revision: 1,
    source: { workspaceId, path: template },
  });
  expect(
    await caller.resources.custom_widget.save({ workspaceId, path: template }),
  ).toMatchObject({ id: created.id, revision: 1 });
  await saved("price-chart.widget.tsx", (text) =>
    text.replace('title: "Price chart"', 'title: "Daily closes"'),
  );
  expect(
    await caller.resources.custom_widget.save({ workspaceId, path: template }),
  ).toMatchObject({ id: created.id, revision: 2, title: "Daily closes" });
});

test("another file cannot take a saved kind", async () => {
  const workspaceId = await caller.resources.workspace.getDefault();
  await caller.resources.custom_widget.save({ workspaceId, path: template });
  const copy = await saved("copy.widget.tsx", (text) => text);
  await expect(
    caller.resources.custom_widget.save({ workspaceId, path: copy }),
  ).rejects.toThrow(
    /Widget kind "price-chart" is saved from widgets\/price-chart\.widget\.tsx\. Declare another kind, or delete custom_widget/,
  );
});

test("serves transpiled code at the saved revision and refuses intrinsic creation", async () => {
  const workspaceId = await caller.resources.workspace.getDefault();
  const { id } = await caller.resources.custom_widget.save({
    workspaceId,
    path: template,
  });
  const compiled = await caller.resources.custom_widget.compiled({
    kind: "price-chart",
  });
  expect(compiled).toMatchObject({ id, revision: 1 });
  expect(compiled?.code).toContain('require("vega-embed")');
  await expect(caller.resources.custom_widget.create({})).rejects.toThrow(
    /Use custom_widget\.save or the save_widget tool/,
  );
  await caller.resources.custom_widget.delete({ id });
  expect(
    await caller.resources.custom_widget.compiled({ kind: "price-chart" }),
  ).toBeNull();
});
