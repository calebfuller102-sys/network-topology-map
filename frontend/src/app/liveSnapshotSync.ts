import type { Snapshot } from "../types";
import type { SnapshotRequest } from "./snapshotCoordinator";

const DEFAULT_RECONNECT_DELAY_MS = 1_000;

export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

/**
 * A fetched snapshot paired with the request ticket assigned before its HTTP
 * work began. The caller owns state application, so live recovery stays a
 * pure fetch path.
 */
export interface SnapshotLoadResult {
  snapshot: Snapshot;
  request: SnapshotRequest;
}

export interface LiveSnapshotSyncOptions {
  eventUrl: (mapId: string, after: number) => string;
  loadSnapshot: () => Promise<SnapshotLoadResult>;
  onSnapshot: (result: SnapshotLoadResult) => void;
  onConnectionChange: (connected: boolean) => void;
  onError: (cause: unknown) => void;
  createEventSource?: (url: string) => EventSourceLike;
  /**
   * Bounds how long a failed stream may wait for native EventSource recovery
   * before it is explicitly replaced after an API restart.
   */
  reconnectDelayMs?: number;
}

interface EventPayload {
  map_id: string;
  revision: number;
  type: string;
}

function defaultEventSource(url: string): EventSourceLike {
  return new EventSource(url);
}

function parsePayload(event: MessageEvent<string>): EventPayload | null {
  try {
    const payload = JSON.parse(event.data) as Partial<EventPayload>;
    const { map_id: mapId, revision, type } = payload;
    if (
      typeof mapId !== "string"
      || typeof revision !== "number"
      || !Number.isSafeInteger(revision)
      || revision < 0
      || typeof type !== "string"
    ) {
      return null;
    }
    return { map_id: mapId, revision, type };
  } catch {
    return null;
  }
}

/**
 * Coalesces event-triggered snapshot reloads. The snapshot revision is the
 * authority: an older response is never allowed to overwrite a newer map.
 */
export class LiveSnapshotSync {
  private readonly eventUrl: LiveSnapshotSyncOptions["eventUrl"];
  private readonly loadSnapshot: LiveSnapshotSyncOptions["loadSnapshot"];
  private readonly onSnapshot: LiveSnapshotSyncOptions["onSnapshot"];
  private readonly onConnectionChange: LiveSnapshotSyncOptions["onConnectionChange"];
  private readonly onError: LiveSnapshotSyncOptions["onError"];
  private readonly createEventSource: (url: string) => EventSourceLike;
  private readonly reconnectDelayMs: number;
  private source: EventSourceLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private mapId: string | null = null;
  private appliedRevision = 0;
  private requiredRevision = 0;
  private refreshing = false;
  private refreshQueued = false;
  private stopped = false;

  constructor(options: LiveSnapshotSyncOptions) {
    this.eventUrl = options.eventUrl;
    this.loadSnapshot = options.loadSnapshot;
    this.onSnapshot = options.onSnapshot;
    this.onConnectionChange = options.onConnectionChange;
    this.onError = options.onError;
    this.createEventSource = options.createEventSource ?? defaultEventSource;
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  }

  start(snapshot: Snapshot): void {
    this.closeSource();
    this.stopped = false;
    this.mapId = snapshot.map.id;
    this.appliedRevision = snapshot.revision;
    this.requiredRevision = snapshot.revision;
    this.onConnectionChange(false);

    this.connect();
  }

  dispose(): void {
    this.stopped = true;
    this.closeSource();
  }

  private connect(): void {
    const mapId = this.mapId;
    if (this.stopped || mapId === null) {
      return;
    }

    const source = this.createEventSource(this.eventUrl(mapId, this.appliedRevision));
    this.source = source;
    source.onopen = () => {
      if (this.stopped || this.source !== source) {
        return;
      }
      this.cancelReconnect();
      this.onConnectionChange(true);
      // A replay catches the narrow handoff gap. A complete snapshot on every
      // open also covers a restarted API and an expired bounded replay cursor.
      this.requestRefresh();
    };
    source.onerror = () => {
      if (this.stopped || this.source !== source) {
        return;
      }
      this.onConnectionChange(false);
      this.scheduleReconnect(source);
    };
    for (const eventType of ["status.updated", "topology.changed", "resync.required"]) {
      source.addEventListener(eventType, (event) => {
        if (this.source === source) {
          this.handleEvent(event);
        }
      });
    }
  }

  private scheduleReconnect(source: EventSourceLike): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped || this.source !== source) {
        return;
      }
      // A native EventSource may still reconnect by itself. Only replace the
      // object if it remained failed for the fallback delay, then retire it
      // before constructing the next one so there is never more than one
      // active stream.
      this.source = null;
      source.close();
      this.connect();
    }, this.reconnectDelayMs);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * An open SSE socket does not make a failed recovery snapshot authoritative.
   * Retry the read at a bounded cadence rather than leaving stale diagnostics
   * visible until a later event happens to arrive.
   */
  private scheduleRefreshRetry(): void {
    if (this.refreshRetryTimer !== null || this.stopped) {
      return;
    }
    this.refreshRetryTimer = setTimeout(() => {
      this.refreshRetryTimer = null;
      if (!this.stopped) {
        this.requestRefresh();
      }
    }, this.reconnectDelayMs);
  }

  private cancelRefreshRetry(): void {
    if (this.refreshRetryTimer !== null) {
      clearTimeout(this.refreshRetryTimer);
      this.refreshRetryTimer = null;
    }
  }

  private closeSource(): void {
    this.cancelReconnect();
    this.cancelRefreshRetry();
    const source = this.source;
    this.source = null;
    source?.close();
  }

  private handleEvent(event: MessageEvent<string>): void {
    if (this.stopped) {
      return;
    }
    const payload = parsePayload(event);
    if (!payload || payload.map_id !== this.mapId) {
      return;
    }
    if (payload.type !== "resync.required" && payload.revision <= this.appliedRevision) {
      return;
    }
    this.requiredRevision = Math.max(this.requiredRevision, payload.revision);
    this.requestRefresh();
  }

  private requestRefresh(): void {
    if (this.refreshing || this.stopped) {
      this.refreshQueued = true;
      return;
    }
    // A new event/open can recover sooner than a timer scheduled after a
    // transient read failure, so it becomes the one authoritative retry.
    this.cancelRefreshRetry();
    this.refreshing = true;
    void this.loadSnapshot()
      .then((result) => {
        const { snapshot } = result;
        if (this.stopped || snapshot.map.id !== this.mapId) {
          return;
        }
        if (snapshot.revision < this.requiredRevision) {
          this.refreshQueued = true;
          return;
        }
        this.appliedRevision = Math.max(this.appliedRevision, snapshot.revision);
        this.onSnapshot(result);
      })
      .catch((cause: unknown) => {
        if (!this.stopped) {
          this.onError(cause);
          this.scheduleRefreshRetry();
        }
      })
      .finally(() => {
        this.refreshing = false;
        if (this.refreshQueued && !this.stopped) {
          this.refreshQueued = false;
          this.requestRefresh();
        }
      });
  }
}
