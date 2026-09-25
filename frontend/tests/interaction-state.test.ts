import assert from "node:assert/strict";
import test from "node:test";
import {
  applyNodePositionChanges,
  completedNodePositionChanges,
  draftResetKey,
  mergeExternalPosition,
} from "../src/app/editorState.ts";
import { NodePositionPersistence } from "../src/app/nodePositionPersistence.ts";
import { ViewportPersistence } from "../src/app/viewportPersistence.ts";
import { GENERATED_ICON_MANIFEST } from "../src/generated/icon-manifest.ts";
import { isRemoteMdiIconId, remoteMdiAssetUrl } from "../src/app/iconId.ts";

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (condition()) {
      return;
    }
    await delay(5);
  }
  assert.fail(message);
}

test("canvas changes preserve untouched records and unsaved inspector fields", () => {
  const selectedNode = { id: "node-a", x: 10, y: 20, name: "Unsaved name" };
  const movedNode = { id: "node-b", x: 30, y: 40, name: "Switch" };

  const nextNodes = applyNodePositionChanges(
    [selectedNode, movedNode],
    [{ id: "node-b", type: "position", position: { x: 300, y: 400 } }],
  );

  assert.strictEqual(nextNodes[0], selectedNode);
  assert.notStrictEqual(nextNodes[1], movedNode);
  assert.deepEqual(nextNodes[1], { ...movedNode, x: 300, y: 400 });

  const draftAfterSelectedNodeDrag = mergeExternalPosition(selectedNode, {
    id: "node-a",
    x: 120,
    y: 220,
  });
  assert.deepEqual(draftAfterSelectedNodeDrag, {
    id: "node-a",
    x: 120,
    y: 220,
    name: "Unsaved name",
  });

  assert.equal(draftResetKey("node-a", 0), draftResetKey("node-a", 0));
  assert.notEqual(draftResetKey("node-a", 0), draftResetKey("node-b", 0));
  assert.notEqual(draftResetKey("node-a", 0), draftResetKey("node-a", 1));
});

test("only a completed drag updates the persisted graph snapshot", () => {
  const completed = completedNodePositionChanges([
    { id: "node-a", type: "position", position: { x: 12, y: 18 }, dragging: true },
    { id: "node-a", type: "position", position: { x: 32, y: 48 }, dragging: false },
  ]);

  assert.deepEqual(completed, [
    { id: "node-a", type: "position", position: { x: 32, y: 48 }, dragging: false },
  ]);
});

test("viewport persistence debounces and serializes the newest viewport", async () => {
  const writes: Array<{ x: number; y: number; zoom: number }> = [];
  let releaseFirstWrite: (() => void) | null = null;
  let activeWrites = 0;
  let peakActiveWrites = 0;

  const persistence = new ViewportPersistence(
    async (viewport) => {
      writes.push(viewport);
      activeWrites += 1;
      peakActiveWrites = Math.max(peakActiveWrites, activeWrites);
      if (writes.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstWrite = resolve;
        });
      }
      activeWrites -= 1;
    },
    (cause) => {
      throw cause;
    },
    1,
  );

  persistence.schedule({ x: 1, y: 2, zoom: 1 });
  await waitFor(() => writes.length === 1, "The first viewport write did not start.");

  persistence.schedule({ x: 10, y: 20, zoom: 1.5 });
  persistence.schedule({ x: 30, y: 40, zoom: 2 });
  await delay(10);
  assert.deepEqual(writes, [{ x: 1, y: 2, zoom: 1 }]);

  assert.ok(releaseFirstWrite);
  releaseFirstWrite();
  await waitFor(() => writes.length === 2, "The newest queued viewport was not saved.");

  assert.deepEqual(writes, [
    { x: 1, y: 2, zoom: 1 },
    { x: 30, y: 40, zoom: 2 },
  ]);
  assert.equal(peakActiveWrites, 1);
});

test("viewport dispose flushes pending work after an in-flight save", async () => {
  const writes: Array<{ x: number; y: number; zoom: number }> = [];
  let releaseFirstWrite: (() => void) | null = null;
  const persistence = new ViewportPersistence(
    async (viewport) => {
      writes.push(viewport);
      if (writes.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstWrite = resolve;
        });
      }
    },
    (cause) => {
      throw cause;
    },
    1,
  );

  persistence.schedule({ x: 1, y: 2, zoom: 1 });
  await waitFor(() => writes.length === 1, "The first viewport write did not start.");
  persistence.schedule({ x: 30, y: 40, zoom: 2 });
  persistence.dispose();

  assert.ok(releaseFirstWrite);
  releaseFirstWrite();
  await waitFor(() => writes.length === 2, "The final viewport was not flushed during dispose.");
  assert.deepEqual(writes, [
    { x: 1, y: 2, zoom: 1 },
    { x: 30, y: 40, zoom: 2 },
  ]);
});

test("viewport dispose immediately flushes a pending debounced save", async () => {
  const writes: Array<{ x: number; y: number; zoom: number }> = [];
  const persistence = new ViewportPersistence(
    async (viewport) => {
      writes.push(viewport);
    },
    (cause) => {
      throw cause;
    },
    50,
  );

  persistence.schedule({ x: 4, y: 5, zoom: 1.1 });
  persistence.dispose();
  await waitFor(() => writes.length === 1, "The pending viewport was not flushed during dispose.");
  assert.deepEqual(writes, [{ x: 4, y: 5, zoom: 1.1 }]);
});

test("page exit sends the pending viewport through its dedicated save strategy", async () => {
  const normalWrites: Array<{ x: number; y: number; zoom: number }> = [];
  const exitWrites: Array<{ x: number; y: number; zoom: number }> = [];
  const persistence = new ViewportPersistence(
    async (viewport) => {
      normalWrites.push(viewport);
    },
    (cause) => {
      throw cause;
    },
    50,
  );

  persistence.schedule({ x: 9, y: 8, zoom: 1.2 });
  persistence.flushForPageExit(async (viewport) => {
    exitWrites.push(viewport);
  });
  await delay(60);

  assert.deepEqual(exitWrites, [{ x: 9, y: 8, zoom: 1.2 }]);
  assert.deepEqual(normalWrites, []);
});

test("node position writes serialize per node and retain the latest drag", async () => {
  const started: Array<{ nodeId: string; x: number; y: number }> = [];
  const release = new Map<string, () => void>();
  const persistence = new NodePositionPersistence(
    async (nodeId, position) => {
      started.push({ nodeId, ...position });
      await new Promise<void>((resolve) => {
        release.set(`${nodeId}:${position.x}`, resolve);
      });
    },
    (cause) => {
      throw cause;
    },
    () => undefined,
  );

  persistence.schedule("node-a", { x: 1, y: 1 });
  persistence.schedule("node-b", { x: 3, y: 3 });
  await waitFor(() => started.length === 2, "Independent node writes did not start.");
  persistence.schedule("node-a", { x: 2, y: 2 });
  await delay(10);
  assert.deepEqual(started, [
    { nodeId: "node-a", x: 1, y: 1 },
    { nodeId: "node-b", x: 3, y: 3 },
  ]);

  release.get("node-b:3")?.();
  release.get("node-a:1")?.();
  await waitFor(() => started.length === 3, "The latest node-a position did not run.");
  assert.deepEqual(started[2], { nodeId: "node-a", x: 2, y: 2 });
  release.get("node-a:2")?.();
});

test("icon search keeps local choices while valid mdi identifiers can load remotely", () => {
  const matchingIcons = (query: string) => GENERATED_ICON_MANIFEST.filter((icon) => (
    icon.id.includes(query) || icon.label.toLocaleLowerCase().includes(query)
  ));
  assert.ok(GENERATED_ICON_MANIFEST.some((icon) => icon.id === "si-docker"));
  assert.equal(GENERATED_ICON_MANIFEST.some((icon) => icon.id === "si-unlisted"), false);
  assert.equal(matchingIcons("docker")[0]?.id, "si-docker");
  assert.ok(matchingIcons("kubernetes").some((icon) => icon.id === "mdi-kubernetes"));
  assert.equal(isRemoteMdiIconId("mdi-vpn"), true);
  assert.equal(isRemoteMdiIconId("mdi-../../not-an-icon"), false);
  assert.equal(remoteMdiAssetUrl("mdi-vpn"), "https://api.iconify.design/mdi/vpn.svg?color=%2379cde3");
  assert.equal(remoteMdiAssetUrl("not-an-icon"), null);
});
