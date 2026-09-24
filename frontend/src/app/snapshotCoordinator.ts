import type { Snapshot } from "../types";

/**
 * Identifies the point at which a snapshot HTTP request began. The request
 * must retain this ticket until its response is considered for application.
 */
export interface SnapshotRequest {
  readonly generation: number;
}

/**
 * Keeps independently fetched snapshots from moving the visible map backward.
 * Event-stream recovery and explicit monitor refreshes can overlap, so state
 * application—not just event handling—must be revision aware.
 */
export class SnapshotCoordinator {
  private mapId: string | null = null;
  private revision = -1;
  private nextGeneration = 0;
  private latestStartedGeneration = 0;
  private appliedGeneration = 0;

  /** Allocate a ticket before starting an independent HTTP snapshot fetch. */
  beginRequest(): SnapshotRequest {
    this.nextGeneration += 1;
    this.latestStartedGeneration = this.nextGeneration;
    return { generation: this.nextGeneration };
  }

  /**
   * Returns false when this response is older than the snapshot already shown.
   * Equal revisions remain valid: a process restart can change derived stale
   * metadata without creating a new persisted map event. For equal revisions,
   * the later-started request wins so an old in-flight refresh cannot undo a
   * newer reconnect snapshot.
   */
  shouldApply(snapshot: Snapshot, request: SnapshotRequest): boolean {
    const { generation } = request;
    this.nextGeneration = Math.max(this.nextGeneration, generation);
    this.latestStartedGeneration = Math.max(this.latestStartedGeneration, generation);
    if (this.mapId !== snapshot.map.id) {
      if (generation < this.latestStartedGeneration) {
        return false;
      }
      this.mapId = snapshot.map.id;
      this.revision = snapshot.revision;
      this.appliedGeneration = generation;
      return true;
    }
    if (snapshot.revision > this.revision) {
      // A strictly newer persisted revision is authoritative even if its
      // request began before another currently in-flight read.
      this.revision = snapshot.revision;
      this.appliedGeneration = Math.max(this.appliedGeneration, generation);
      return true;
    }
    if (snapshot.revision < this.revision) {
      return false;
    }
    if (
      generation < this.latestStartedGeneration
      || generation < this.appliedGeneration
    ) {
      return false;
    }
    this.appliedGeneration = generation;
    return true;
  }
}
