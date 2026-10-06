/** Shares one refresh per account generation; retiring it never releases its replacement. */
export class AccountRefresh<T> {
  private revision = 0;
  pending?: Promise<T>;

  invalidate() {
    this.revision++;
    this.pending = undefined;
  }

  run(work: () => Promise<T>): Promise<T> {
    if (this.pending) return this.pending;
    const revision = this.revision;
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<T>((done, failed) => {
      resolve = done;
      reject = failed;
    });
    this.pending = result;
    const release = () => {
      if (this.pending === result) this.pending = undefined;
    };
    try {
      void work().then(
        (value) => {
          release();
          if (revision === this.revision) resolve(value);
          else reject(new Error("Account refresh changed"));
        },
        (error: unknown) => {
          release();
          reject(error);
        },
      );
    } catch (error) {
      release();
      reject(error);
    }
    return result;
  }
}
