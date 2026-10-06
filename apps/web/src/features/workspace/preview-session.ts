interface PreviewUrls {
  create(blob: Blob): string;
  revoke(url: string): void;
}

/** One preview request per active lifetime; retired responses never allocate image URLs. */
export class PreviewSession {
  private url = "";
  private active = false;
  private revision = 0;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();

  constructor(
    private readonly load: (signal: AbortSignal) => Promise<Blob>,
    private readonly urls: PreviewUrls,
    private readonly intervalMs = 2000,
  ) {}

  snapshot = () => this.url;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(url: string) {
    const previous = this.url;
    this.url = url;
    if (previous) this.urls.revoke(previous);
    for (const listener of this.listeners) listener();
  }
  start() {
    if (this.active) return;
    this.active = true;
    void this.poll();
  }
  stop() {
    this.active = false;
    this.revision++;
    this.controller?.abort();
    this.controller = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.url) this.publish("");
  }
  private async poll() {
    if (!this.active || this.controller) return;
    const revision = this.revision;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const blob = await this.load(controller.signal);
      if (!this.active || revision !== this.revision) return;
      this.publish(this.urls.create(blob));
    } catch {
      if (this.active && revision === this.revision && this.url)
        this.publish("");
    } finally {
      if (this.controller === controller) this.controller = undefined;
      if (this.active && revision === this.revision)
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.poll();
        }, this.intervalMs);
    }
  }
}
