import type { Viewport } from "@xyflow/react";

type SaveViewport = (viewport: Viewport) => Promise<unknown>;
type ReportError = (cause: unknown) => void;

/**
 * Keeps viewport writes debounced and strictly serialized. A later movement
 * replaces any queued viewport, so a slower earlier response cannot win.
 */
export class ViewportPersistence {
  private readonly save: SaveViewport;
  private readonly reportError: ReportError;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Viewport | null = null;
  private inFlight = false;
  private disposed = false;

  constructor(save: SaveViewport, reportError: ReportError, debounceMs = 300) {
    this.save = save;
    this.reportError = reportError;
    this.debounceMs = debounceMs;
  }

  schedule(viewport: Viewport): void {
    if (this.disposed) {
      return;
    }

    this.pending = { ...viewport };
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private flush(): void {
    if (this.disposed || this.inFlight || !this.pending) {
      return;
    }

    const viewport = this.pending;
    this.pending = null;
    this.inFlight = true;

    void this.save(viewport)
      .catch((cause: unknown) => {
        if (!this.disposed) {
          this.reportError(cause);
        }
      })
      .finally(() => {
        this.inFlight = false;
        // If the debounce timer has already fired while a request was pending,
        // immediately save its newest viewport. Otherwise let the timer finish.
        if (!this.disposed && this.pending && this.timer === null) {
          this.flush();
        }
      });
  }
}
