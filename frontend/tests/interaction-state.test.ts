import assert from "node:assert/strict";
import test from "node:test";
import {
  applyNodePositionChanges,
  draftResetKey,
  mergeExternalPosition,
} from "../src/app/editorState.ts";
import { ViewportPersistence } from "../src/app/viewportPersistence.ts";

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
