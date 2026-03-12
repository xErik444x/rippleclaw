export class Semaphore {
  private current = 0;
  private queue: Array<(release: () => void) => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.current < this.max) {
      this.current++;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next(() => this.release());
      return;
    }
    this.current = Math.max(0, this.current - 1);
  }
}
