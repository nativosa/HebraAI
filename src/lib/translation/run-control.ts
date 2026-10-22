// Tracks the current translation run in the browser. Starting a run or
// cancelling makes the previous run stale at once and aborts its request, so
// results that arrive later (even ones already received but not yet applied)
// can be discarded with isCurrent().
export class RunControl {
  private current = 0;
  private controller: AbortController | null = null;

  start(): { id: number; signal: AbortSignal } {
    this.controller?.abort();
    this.controller = new AbortController();
    return { id: ++this.current, signal: this.controller.signal };
  }

  cancel(): void {
    this.current++;
    this.controller?.abort();
    this.controller = null;
  }

  isCurrent(id: number): boolean {
    return id === this.current;
  }
}
