import assert from "node:assert/strict";
import test from "node:test";
import { SnapshotCoordinator } from "../src/app/snapshotCoordinator.ts";
import type { Snapshot, Status } from "../src/types.ts";

function snapshot(revision: number, status: Status): Snapshot {
  return {
    revision,
    map: {
      id: "map-a",
      name: "Fixture",
      viewport_x: 0,
      viewport_y: 0,
      viewport_zoom: 1,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    nodes: [],
    links: [],
    monitors: [],
    statuses: [{ node_id: "node-a", status, monitors: [] }],
  };
}

test("older request A cannot overwrite newer request B at the same revision", async () => {
  const coordinator = new SnapshotCoordinator();
  let visible: Snapshot | null = null;
  let resolveOlder: ((value: Snapshot) => void) | null = null;
  const requestA = coordinator.beginRequest();
  const olderRefresh = new Promise<Snapshot>((resolve) => {
    resolveOlder = resolve;
  }).then((next) => {
    if (coordinator.shouldApply(next, requestA)) {
      visible = next;
    }
  });

  const requestB = coordinator.beginRequest();
  const newerSnapshot = snapshot(8, "unknown");
  assert.equal(coordinator.shouldApply(newerSnapshot, requestB), true);
  visible = newerSnapshot;

  assert.ok(resolveOlder);
  resolveOlder(snapshot(8, "offline"));
  await olderRefresh;

  assert.equal(visible.revision, 8);
  assert.equal(visible.statuses[0].status, "unknown");
});

test("a newer equal-revision reconnect snapshot can refresh derived stale metadata", () => {
  const coordinator = new SnapshotCoordinator();
  const initialRequest = coordinator.beginRequest();
  assert.equal(coordinator.shouldApply(snapshot(12, "offline"), initialRequest), true);

  const reconnectRequest = coordinator.beginRequest();
  assert.equal(coordinator.shouldApply(snapshot(12, "unknown"), reconnectRequest), true);
});

test("an older equal-revision response is ignored once a newer request has started", () => {
  const coordinator = new SnapshotCoordinator();
  const initialRequest = coordinator.beginRequest();
  assert.equal(coordinator.shouldApply(snapshot(12, "offline"), initialRequest), true);

  const olderRequest = coordinator.beginRequest();
  const newerRequest = coordinator.beginRequest();
  assert.equal(coordinator.shouldApply(snapshot(12, "offline"), olderRequest), false);
  assert.equal(coordinator.shouldApply(snapshot(12, "unknown"), newerRequest), true);
});

test("a higher revision remains safe when its request started first", () => {
  const coordinator = new SnapshotCoordinator();
  const olderRequest = coordinator.beginRequest();
  const newerRequest = coordinator.beginRequest();

  assert.equal(coordinator.shouldApply(snapshot(12, "offline"), newerRequest), true);
  assert.equal(coordinator.shouldApply(snapshot(13, "online"), olderRequest), true);
});
