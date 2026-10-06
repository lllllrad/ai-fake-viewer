import {
  shouldRecoverAi,
  unavailableReason,
  type BroadcastConflict,
} from "../../domain/broadcast/lifecycle.ts";
import type { BroadcastDependencies } from "./ports.ts";

export class BroadcastCommandError extends Error {
  readonly statusCode = 409;
  constructor(public readonly code: BroadcastConflict) {
    super(
      {
        closed: "방송이 종료되었습니다. 새 방송을 시작해 주세요.",
        shutting_down:
          "서버를 종료하고 있습니다. 연결이 복구된 뒤 다시 시도해 주세요.",
        inputs_stopping:
          "입력 연결을 정리하고 있습니다. 잠시 후 다시 시도해 주세요.",
      }[code],
    );
  }
}

/**
 * Owns operator intent and broadcast transitions, independently of HTTP and SQL.
 * Stop is immediate. An asynchronous teardown may never resume an older start.
 */
export class BroadcastService {
  private shuttingDown = false;
  private commandRevision = 0;
  private inputStop?: Promise<void>;
  private shutdownResult?: Promise<void>;

  constructor(private readonly dependencies: BroadcastDependencies) {}

  private availability() {
    return {
      closed: this.dependencies.repository.closed(),
      shuttingDown: this.shuttingDown,
      stoppingInputs: !!this.inputStop,
    };
  }

  private assertOpen() {
    const reason = unavailableReason(this.availability());
    if (reason) throw new BroadcastCommandError(reason);
  }

  startInputs() {
    this.assertOpen();
    this.dependencies.inputs.start();
  }

  enableAi() {
    this.assertOpen();
    this.dependencies.inputs.prepareForAi();
    this.dependencies.ai.start();
  }

  disableAi(reason = "stopped") {
    if (this.shuttingDown) return;
    this.commandRevision++;
    this.dependencies.ai.stop(reason, false);
    this.dependencies.cast.disarm(reason);
  }

  private stopInputAdapters() {
    if (this.inputStop) return this.inputStop;
    const inputs = this.dependencies.inputs;
    const attempt = (stop: () => void | Promise<void>) => {
      try {
        return Promise.resolve(stop());
      } catch (error) {
        return Promise.reject(error);
      }
    };
    // Invoke all stops immediately, even if another adapter throws synchronously.
    const stopping = Promise.allSettled([
      attempt(() => inputs.stopScreen()),
      attempt(() => inputs.stopSpeech()),
      attempt(() => inputs.stopChat()),
    ]).then((results) => {
      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (failures.length)
        throw new AggregateError(
          failures.map((r) => r.reason),
          "Input shutdown failed",
        );
    });
    const result = stopping.finally(() => {
      if (this.inputStop === result) this.inputStop = undefined;
    });
    this.inputStop = result;
    return result;
  }

  stopInputs() {
    this.disableAi();
    return this.stopInputAdapters();
  }

  endBroadcast() {
    if (this.shuttingDown) return this.shutdownResult ?? Promise.resolve();
    this.disableAi("broadcast_ended");
    // Close the publication/ingestion gate synchronously, before async transport shutdown.
    try {
      if (!this.dependencies.repository.closed())
        this.dependencies.repository.end();
    } catch (error) {
      // A failed durable close must still stop every external input.
      return this.stopInputAdapters().then(
        () => {
          throw error;
        },
        () => {
          throw error;
        },
      );
    }
    return this.stopInputAdapters();
  }

  async newBroadcast() {
    if (this.shuttingDown) throw new BroadcastCommandError("shutting_down");
    this.disableAi();
    const revision = this.commandRevision;
    await this.stopInputAdapters();
    if (revision !== this.commandRevision || this.shuttingDown) return false;
    this.dependencies.repository.createNext();
    this.dependencies.inputs.start();
    return true;
  }

  disclose() {
    this.assertOpen();
    this.disableAi();
    this.dependencies.repository.disclose();
  }

  async eraseData() {
    if (this.shuttingDown) throw new BroadcastCommandError("shutting_down");
    this.disableAi();
    const revision = this.commandRevision;
    this.dependencies.cast.cancelJobs();
    await this.stopInputAdapters();
    if (revision !== this.commandRevision || this.shuttingDown) return false;
    this.dependencies.repository.erase();
    return true;
  }

  recoverAi() {
    const { ai, repository } = this.dependencies;
    const state = {
      ...this.availability(),
      requested: repository.aiRequested(),
      running: ai.running(),
    };
    if (unavailableReason(state) || !state.requested) return false;
    if (!shouldRecoverAi(state)) return true;
    try {
      ai.start();
      return true;
    } catch {
      // Preserve durable intent while the selected provider or fresh input is unavailable.
      ai.waitForRecovery();
      return false;
    }
  }

  shutdown() {
    if (this.shutdownResult) return this.shutdownResult;
    this.shuttingDown = true;
    this.commandRevision++;
    this.dependencies.ai.stop("server_shutdown", true);
    this.shutdownResult = this.stopInputAdapters();
    return this.shutdownResult;
  }
}
