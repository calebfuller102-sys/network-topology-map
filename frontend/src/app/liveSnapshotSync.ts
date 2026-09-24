import type { Snapshot } from "../types";

export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export interface LiveSnapshotSyncOptions {
  eventUrl: (mapId: string, after: number) => string;
  loadSnapshot: () => Promise<Snapshot>;
  onSnapshot: (snapshot: Snapshot) => void;
  onConnectionChange: (connected: boolean) => void;
  onError: (cause: unknown) => void;
  createEventSource?: (url: string) => EventSourceLike;
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
  private source: EventSourceLike | null = null;
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
  }

  start(snapshot: Snapshot): void {
    this.stopped = false;
    this.mapId = snapshot.map.id;
    this.appliedRevision = snapshot.revision;
    this.requiredRevision = snapshot.revision;
    this.onConnectionChange(false);

    const source = this.createEventSource(this.eventUrl(snapshot.map.id, snapshot.revision));
    this.source = source;
    source.onopen = () => {
      if (this.stopped) {
        return;
      }
      this.onConnectionChange(true);
      // A replay catches the narrow handoff gap. A complete snapshot on every
      // open also covers a restarted API and an expired bounded replay cursor.
      this.requestRefresh();
    };
    source.onerror = () => {
      if (!this.stopped) {
        this.onConnectionChange(false);
      }
    };
    for (const eventType of ["status.updated", "topology.changed", "resync.required"]) {
      source.addEventListener(eventType, (event) => this.handleEvent(event));
    }
  }

  dispose(): void {
    this.stopped = true;
    this.source?.close();
    this.source = null;
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
    this.refreshing = true;
    void this.loadSnapshot()
      .then((snapshot) => {
        if (this.stopped || snapshot.map.id !== this.mapId) {
          return;
        }
        if (snapshot.revision < this.requiredRevision) {
          this.refreshQueued = true;
          return;
        }
        this.appliedRevision = Math.max(this.appliedRevision, snapshot.revision);
        this.onSnapshot(snapshot);
      })
      .catch((cause: unknown) => {
        if (!this.stopped) {
          this.onError(cause);
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
