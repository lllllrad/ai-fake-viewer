export interface GenerationLease {
  readonly generation: number;
  readonly signal: AbortSignal;
}
/** Owns the current asynchronous attempt; canceled completions cannot release newer work. */
export class GenerationWork<Input> {
  private revision = 0;
  private active?: {
    lease: GenerationLease;
    controller: AbortController;
    inputs: Set<Input>;
  };
  constructor(private readonly discard: (input: Input) => void) {}
  get generation() {
    return this.revision;
  }
  get busy() {
    return this.active !== undefined;
  }
  get controller() {
    return this.active?.controller;
  }
  begin(input: Input): GenerationLease {
    if (this.active) throw new Error("Reaction generation is already active");
    const controller = new AbortController();
    const lease = { generation: this.revision, signal: controller.signal };
    this.active = { lease, controller, inputs: new Set([input]) };
    return lease;
  }
  current(lease: GenerationLease) {
    return this.active?.lease === lease && lease.generation === this.revision;
  }
  track(lease: GenerationLease, input: Input) {
    if (this.current(lease)) this.active!.inputs.add(input);
    else this.discard(input);
  }
  finish(lease: GenerationLease) {
    if (!this.current(lease)) return false;
    this.active = undefined;
    return true;
  }
  cancel() {
    this.revision++;
    const active = this.active;
    this.active = undefined;
    if (!active) return;
    for (const input of active.inputs) this.discard(input);
    active.inputs.clear();
    active.controller.abort();
  }
}
