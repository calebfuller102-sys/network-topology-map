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
  private accepting = true;

  constructor(save: SaveViewport, reportError: ReportError, debounceMs = 300) {
    this.save = save;
    this.reportError = reportError;
    this.debounceMs = debounceMs;
  }

  schedule(viewport: Viewport): void {
    if (!this.accepting) {
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
    this.accepting = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // A component unmount is usually not a document exit. Keep draining the
    // queue so a pending viewport follows an in-flight write in order.
    this.flush();
  }

  flushForPageExit(saveForPageExit: SaveViewport): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const viewport = this.pending;
    this.pending = null;
    if (!viewport) {
      return;
    }
    // keepalive fetch is the browser-supported best effort for a short PATCH
    // during pagehide. It cannot promise delivery after a hard process exit.
    void saveForPageExit(viewport).catch(() => undefined);
  }

  private flush(): void {
    if (this.inFlight || !this.pending) {
      return;
    }

    const viewport = this.pending;
    this.pending = null;
    this.inFlight = true;

    void this.save(viewport)
      .catch((cause: unknown) => {
        this.reportError(cause);
      })
      .finally(() => {
        this.inFlight = false;
        // If the debounce timer has already fired while a request was pending,
        // immediately save its newest viewport. Otherwise let the timer finish.
        if (this.pending && this.timer === null) {
          this.flush();
        }
      });
  }
}
