import { initialViewerStateSchema } from "../../contracts/model-tools.ts";
import type { ReactionProgram } from "../../application/reactions/program.ts";
import { encodeWire, decodeWire } from "./wire.ts";
export interface AiServiceConnection {
  url: string;
  token: string;
}
export class AiServiceClient {
  constructor(
    readonly connection: AiServiceConnection,
    private readonly request: typeof fetch = fetch,
  ) {
    const url = new URL(connection.url);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error("AI service must use a local HTTP endpoint");
    if (connection.token.length < 32) throw Error("AI service token required");
  }
  async json(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    method = body === undefined ? "GET" : "POST",
  ): Promise<any> {
    const response = await this.request(new URL(path, this.connection.url), {
      method,
      signal: AbortSignal.any([
        signal ?? new AbortController().signal,
        AbortSignal.timeout(15000),
      ]),
      headers: {
        authorization: `Bearer ${this.connection.token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(encodeWire(body)),
      redirect: "error",
    });
    if (!response.ok)
      throw Error(`AI service unavailable (${response.status})`);
    return decodeWire(await response.json());
  }
  program(
    id: string,
    revision: number,
    initialState: import("../../contracts/model-tools.ts").ViewerState,
  ): ReactionProgram {
    return {
      initialState: initialViewerStateSchema.parse(initialState),
      select: async (input, signal) => {
        const response = await this.json(
          "/v1/select",
          { pipelineType: id, revision, input },
          signal,
        );
        if (!response.selected) return undefined;
        const index = input.members.findIndex(
          (member) => member.id === response.selected.member?.id,
        );
        if (index < 0) throw Error("AI service selected an unknown viewer");
        return { ...response.selected, index, member: input.members[index] };
      },
      draft: async (options) => {
        let runId: string | undefined;
        const evidence = () => ({
          frames: options.latestFrames(),
          validTranscripts: (options.input.transcripts ?? [])
            .filter((t) => options.hasTranscript(t.id))
            .map((t) => t.id),
        });
        const cancel = () => {
          if (runId)
            void this.json(
              `/v1/runs/${runId}`,
              undefined,
              undefined,
              "DELETE",
            ).catch(() => {});
        };
        options.signal.addEventListener("abort", cancel, { once: true });
        try {
          let packet = await this.json(
            "/v1/runs",
            {
              pipelineType: id,
              revision,
              input: options.input,
              review: options.review,
              inspectAllowed: options.inspectAllowed,
              ...evidence(),
            },
            options.signal,
          );
          runId = packet.id;
          for (let steps = 0; steps < 100; steps++) {
            options.signal.throwIfAborted();
            if (!options.isCurrent()) return { kind: "canceled" };
            if (packet.phase) options.phase(packet.phase);
            for (const event of packet.traces ?? [])
              options.trace(event.event, event.details);
            if (packet.kind === "done") return packet.outcome;
            if (packet.kind === "state") {
              if (!options.updateState)
                throw Error("Viewer state port unavailable");
              const result = await options.updateState(packet.values);
              packet = await this.json(
                `/v1/runs/${runId}/continue`,
                { step: packet.step, result, ...evidence() },
                options.signal,
              );
              continue;
            }
            if (packet.kind !== "model")
              throw Error("AI service pipeline failed");
            options.active(packet.input);
            const result = await options.model(packet.input, options.signal);
            options.signal.throwIfAborted();
            if (!options.isCurrent()) return { kind: "canceled" };
            packet = await this.json(
              `/v1/runs/${runId}/continue`,
              { step: packet.step, result, ...evidence() },
              options.signal,
            );
          }
          throw Error("AI service step limit exceeded");
        } finally {
          options.signal.removeEventListener("abort", cancel);
          cancel();
        }
      },
    };
  }
}
