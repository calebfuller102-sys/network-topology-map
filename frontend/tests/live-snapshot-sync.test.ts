import assert from "node:assert/strict";
import test from "node:test";
import { LiveSnapshotSync, type EventSourceLike } from "../src/app/liveSnapshotSync.ts";
import type { Snapshot, Status } from "../src/types.ts";

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (condition()) {
      return;
    }
    await delay(5);
  }
  assert.fail(message);
}

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
    nodes: [{
      id: "node-a",
      map_id: "map-a",
      name: "Fixture node",
      kind: "service",
      icon_id: "mdi-server",
      ipv4: "127.0.0.1",
      display_port: null,
      x: 0,
      y: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }],
    links: [],
    monitors: [],
    statuses: [{ node_id: "node-a", status, monitors: [] }],
  };
}

class FakeEventSource implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
  closed = false;

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }

  send(type: string, revision: number): void {
    const event = { data: JSON.stringify({ map_id: "map-a", revision, type }) } as MessageEvent<string>;
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

test("replays an event that arrives in the snapshot-to-subscribe handoff", async () => {
  const source = new FakeEventSource();
  const applied: Snapshot[] = [];
  let requests = 0;
  const sync = new LiveSnapshotSync({
    eventUrl: (mapId, after) => `/api/v1/maps/${mapId}/events?after=${after}`,
    loadSnapshot: async () => {
      requests += 1;
      return snapshot(2, "online");
    },
    onSnapshot: (next) => applied.push(next),
    onConnectionChange: () => undefined,
    onError: (cause) => { throw cause; },
    createEventSource: (url) => {
      assert.equal(url, "/api/v1/maps/map-a/events?after=1");
      return source;
    },
  });

  sync.start(snapshot(1, "unknown"));
  source.send("status.updated", 2);
  await waitFor(() => requests === 1, "The replayed status event did not request a snapshot.");
  await waitFor(() => applied.length === 1, "The replayed snapshot was not applied.");
  assert.equal(applied[0].statuses[0].status, "online");
  sync.dispose();
});

test("connection loss is visible and a reopened stream refreshes an API-restart snapshot", async () => {
  const source = new FakeEventSource();
  const states: boolean[] = [];
  const applied: Snapshot[] = [];
  const snapshots = [snapshot(4, "online"), snapshot(4, "unknown")];
  const sync = new LiveSnapshotSync({
    eventUrl: () => "/events",
    loadSnapshot: async () => snapshots.shift()!,
    onSnapshot: (next) => applied.push(next),
    onConnectionChange: (connected) => states.push(connected),
    onError: (cause) => { throw cause; },
    createEventSource: () => source,
  });

  sync.start(snapshot(4, "online"));
  source.open();
  await waitFor(() => applied.length === 1, "Initial SSE open did not refresh the snapshot.");
  source.fail();
  source.open();
  await waitFor(() => applied.length === 2, "Reconnected SSE did not refresh the snapshot.");
  assert.deepEqual(states, [false, true, false, true]);
  assert.equal(applied[1].statuses[0].status, "unknown");
  sync.dispose();
});

test("coalesces rapid events and rejects an older snapshot response", async () => {
  const source = new FakeEventSource();
  const applied: Snapshot[] = [];
  let resolveFirst: ((value: Snapshot) => void) | null = null;
  const sync = new LiveSnapshotSync({
    eventUrl: () => "/events",
    loadSnapshot: async () => {
      if (!resolveFirst) {
        return new Promise<Snapshot>((resolve) => { resolveFirst = resolve; });
      }
      return snapshot(3, "offline");
    },
    onSnapshot: (next) => applied.push(next),
    onConnectionChange: () => undefined,
    onError: (cause) => { throw cause; },
    createEventSource: () => source,
  });

  sync.start(snapshot(1, "unknown"));
  source.send("status.updated", 2);
  await waitFor(() => resolveFirst !== null, "The first snapshot request did not start.");
  source.send("topology.changed", 3);
  resolveFirst?.(snapshot(2, "online"));
  await waitFor(() => applied.length === 1, "The latest snapshot was not eventually applied.");
  assert.equal(applied[0].revision, 3);
  assert.equal(applied[0].statuses[0].status, "offline");
  sync.dispose();
});
