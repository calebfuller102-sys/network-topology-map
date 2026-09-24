interface Position {
  x: number;
  y: number;
}

type SavePosition = (nodeId: string, position: Position) => Promise<unknown>;
type ReportError = (cause: unknown) => void;
type ReportSaved = () => void;

interface Entry {
  pending: Position | null;
  inFlight: boolean;
  failure: unknown | null;
}

/**
 * Serializes position writes for each node. A later drag replaces queued work
 * for that node while independent nodes may still save concurrently.
 */
export class NodePositionPersistence {
  private readonly save: SavePosition;
  private readonly reportError: ReportError;
  private readonly reportSaved: ReportSaved;
  private readonly entries = new Map<string, Entry>();

  constructor(save: SavePosition, reportError: ReportError, reportSaved: ReportSaved) {
    this.save = save;
    this.reportError = reportError;
    this.reportSaved = reportSaved;
  }

  schedule(nodeId: string, position: Position): void {
    const entry = this.entries.get(nodeId) ?? { pending: null, inFlight: false, failure: null };
    this.entries.set(nodeId, entry);
    entry.pending = { ...position };
    this.flush(nodeId, entry);
  }

  private flush(nodeId: string, entry: Entry): void {
    if (entry.inFlight || !entry.pending) {
      return;
    }

    const position = entry.pending;
    entry.pending = null;
    entry.inFlight = true;
    void this.save(nodeId, position)
      .then(() => {
        // A later successful position is authoritative over an earlier failure.
        entry.failure = null;
      })
      .catch((cause: unknown) => {
        entry.failure = cause;
      })
      .finally(() => {
        entry.inFlight = false;
        if (entry.pending) {
          this.flush(nodeId, entry);
        } else {
          this.entries.delete(nodeId);
          if (entry.failure) {
            this.reportError(entry.failure);
          } else {
            this.reportSaved();
          }
        }
      });
  }
}
