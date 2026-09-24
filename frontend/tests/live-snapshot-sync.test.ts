import assert from "node:assert/strict";
import test from "node:test";
import {
  LiveSnapshotSync,
  type EventSourceLike,
  type SnapshotLoadResult,
} from "../src/app/liveSnapshotSync.ts";
import type { Snapshot, Status } from "../src/types.ts";

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
let nextRequestGeneration = 0;

function loadResult(next: Snapshot): SnapshotLoadResult {
  nextRequestGeneration += 1;
  return { snapshot: next, request: { generation: nextRequestGeneration } };
}

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

function snapshotWithMonitor(revision: number, status: Status, result: Snapshot["monitors"][number]["result"]): Snapshot {
  const next = snapshot(revision, status);
  next.monitors = [{
    id: "monitor-a",
    node_id: "node-a",
    kind: "tcp",
    enabled: true,
    target_ipv4: "127.0.0.1",
    port: 8080,
    scheme: null,
    path: null,
    host_header: null,
    verify_tls: true,
    interval_seconds: 30,
    timeout_seconds: 3,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    result,
  }];
  next.statuses = [{
    node_id: "node-a",
    status,
    monitors: [{
      id: "monitor-a",
      kind: "tcp",
      success: result?.success ?? null,
      checked_at: result?.checked_at ?? null,
      error_code: result?.error_code ?? null,
      stale: result?.stale ?? false,
    }],
  }];
  return next;
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
      return loadResult(snapshot(2, "online"));
    },
    onSnapshot: (next) => applied.push(next.snapshot),
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
  const snapshots = [loadResult(snapshot(4, "online")), loadResult(snapshot(4, "unknown"))];
  const sync = new LiveSnapshotSync({
    eventUrl: () => "/events",
    loadSnapshot: async () => snapshots.shift()!,
    onSnapshot: (next) => applied.push(next.snapshot),
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

test("retries a transient authoritative recovery snapshot failure without waiting for another event", async () => {
  const source = new FakeEventSource();
  const applied: Snapshot[] = [];
  const errors: string[] = [];
  let requests = 0;
  const sync = new LiveSnapshotSync({
    eventUrl: () => "/events",
    loadSnapshot: async () => {
      requests += 1;
      if (requests === 1) {
        throw new Error("temporary snapshot failure");
      }
      return loadResult(snapshot(4, "unknown"));
    },
    onSnapshot: (next) => applied.push(next.snapshot),
    onConnectionChange: () => undefined,
    onError: (cause) => errors.push(cause instanceof Error ? cause.message : String(cause)),
    reconnectDelayMs: 5,
    createEventSource: () => source,
  });

  sync.start(snapshot(4, "online"));
  source.open();
  await waitFor(() => errors.length === 1, "The failed recovery snapshot was not reported.");
  await waitFor(() => applied.length === 1, "The recovery snapshot did not retry after its transient failure.");
  assert.equal(requests, 2);
  assert.equal(applied[0].statuses[0].status, "unknown");
  sync.dispose();
});

test("disposing cancels a pending recovery snapshot retry", async () => {
  const source = new FakeEventSource();
  let requests = 0;
  const sync = new LiveSnapshotSync({
    eventUrl: () => "/events",
    loadSnapshot: async () => {
      requests += 1;
      throw new Error("temporary snapshot failure");
    },
    onSnapshot: () => undefined,
    onConnectionChange: () => undefined,
    onError: () => undefined,
    reconnectDelayMs: 20,
    createEventSource: () => source,
  });

  sync.start(snapshot(4, "online"));
  source.open();
  await waitFor(() => requests === 1, "The first recovery snapshot did not start.");
  await delay(5);
  sync.dispose();
  await delay(30);
  assert.equal(requests, 1, "Disposed sync must not retry a failed snapshot.");
});

test("replaces a failed stream that native EventSource leaves stuck after an API restart", async () => {
  const sources: FakeEventSource[] = [];
  const urls: string[] = [];
  const states: boolean[] = [];
  const applied: Snapshot[] = [];
  const snapshots = [loadResult(snapshot(4, "online")), loadResult(snapshot(4, "unknown"))];
  const sync = new LiveSnapshotSync({
    eventUrl: (mapId, after) => `/events/${mapId}?after=${after}`,
    loadSnapshot: async () => snapshots.shift()!,
    onSnapshot: (next) => applied.push(next.snapshot),
    onConnectionChange: (connected) => states.push(connected),
    onError: (cause) => { throw cause; },
    reconnectDelayMs: 5,
    createEventSource: (url) => {
      const prior = sources[sources.length - 1];
      if (prior) {
        assert.equal(prior.closed, true, "Replacement EventSource must retire the failed stream first.");
      }
      urls.push(url);
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    },
  });

  sync.start(snapshot(4, "online"));
  sources[0].open();
  await waitFor(() => applied.length === 1, "Initial SSE open did not refresh the snapshot.");
  sources[0].fail();

  await waitFor(() => sources.length === 2, "The failed stream was not replaced.");
  assert.equal(sources[0].closed, true);
  assert.deepEqual(urls, ["/events/map-a?after=4", "/events/map-a?after=4"]);

  // The replacement—not a late callback from the retired source—must restore
  // the connection and fetch the post-restart authoritative snapshot.
  sources[0].open();
  await delay(10);
  assert.deepEqual(states, [false, true, false]);
  sources[1].open();
  await waitFor(() => applied.length === 2, "Replacement SSE open did not refresh the snapshot.");
  assert.deepEqual(states, [false, true, false, true]);
  assert.equal(applied[1].statuses[0].status, "unknown");
  sync.dispose();
});

test("cancels a pending fallback when native reconnects or the sync is disposed", async () => {
  const sources: FakeEventSource[] = [];
  let requests = 0;
  const sync = new LiveSnapshotSync({
    eventUrl: () => "/events",
    loadSnapshot: async () => {
      requests += 1;
      return loadResult(snapshot(4, "online"));
    },
    onSnapshot: () => undefined,
    onConnectionChange: () => undefined,
    onError: (cause) => { throw cause; },
    reconnectDelayMs: 20,
    createEventSource: () => {
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    },
  });

  sync.start(snapshot(4, "online"));
  sources[0].open();
  await waitFor(() => requests === 1, "Initial SSE open did not request a snapshot.");
  sources[0].fail();
  sources[0].open();
  await delay(30);
  assert.equal(sources.length, 1, "Native reconnection should cancel the replacement fallback.");

  sources[0].fail();
  sync.dispose();
  await delay(30);
  assert.equal(sources.length, 1, "Disposed sync must not create a fallback stream.");
  assert.equal(sources[0].closed, true);
});

test("reconnect replaces stale monitor diagnostics with the authoritative API-restart snapshot", async () => {
  const source = new FakeEventSource();
  const applied: Snapshot[] = [];
  const priorResult = {
    monitor_id: "monitor-a",
    success: false,
    checked_at: "2026-01-01T00:00:04Z",
    latency_ms: 3000,
    http_status: null,
    error_code: "timeout",
    error_message: "TCP connection timed out",
    stale: true,
  };
  const snapshots = [
    loadResult(snapshotWithMonitor(5, "offline", priorResult)),
    // Process restart does not reset the persisted map event revision.
    loadResult(snapshotWithMonitor(5, "unknown", null)),
  ];
  const sync = new LiveSnapshotSync({
    eventUrl: () => "/events",
    loadSnapshot: async () => snapshots.shift()!,
    onSnapshot: (next) => applied.push(next.snapshot),
    onConnectionChange: () => undefined,
    onError: (cause) => { throw cause; },
    createEventSource: () => source,
  });

  sync.start(snapshotWithMonitor(5, "offline", priorResult));
  source.open();
  await waitFor(() => applied.length === 1, "Initial monitor snapshot did not apply.");
  source.fail();
  source.open();
  await waitFor(() => applied.length === 2, "Reconnect monitor snapshot did not apply.");
  assert.equal(applied[1].statuses[0].status, "unknown");
  assert.equal(applied[1].monitors[0].result, null);
  sync.dispose();
});

test("coalesces rapid events and rejects an older snapshot response", async () => {
  const source = new FakeEventSource();
  const applied: Snapshot[] = [];
  let resolveFirst: ((value: SnapshotLoadResult) => void) | null = null;
  const sync = new LiveSnapshotSync({
    eventUrl: () => "/events",
    loadSnapshot: async () => {
      if (!resolveFirst) {
        return new Promise<SnapshotLoadResult>((resolve) => { resolveFirst = resolve; });
      }
      return loadResult(snapshot(3, "offline"));
    },
    onSnapshot: (next) => applied.push(next.snapshot),
    onConnectionChange: () => undefined,
    onError: (cause) => { throw cause; },
    createEventSource: () => source,
  });

  sync.start(snapshot(1, "unknown"));
  source.send("status.updated", 2);
  await waitFor(() => resolveFirst !== null, "The first snapshot request did not start.");
  source.send("topology.changed", 3);
  resolveFirst?.(loadResult(snapshot(2, "online")));
  await waitFor(() => applied.length === 1, "The latest snapshot was not eventually applied.");
  assert.equal(applied[0].revision, 3);
  assert.equal(applied[0].statuses[0].status, "offline");
  sync.dispose();
});
