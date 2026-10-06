import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

interface StreamRequest {
  live_chat_id: string;
  part: string[];
  page_token?: string;
}
export interface YoutubeStream extends AsyncIterable<unknown> {
  cancel(): void;
}
export interface YoutubeStreamClient {
  StreamList(request: StreamRequest, metadata: grpc.Metadata): YoutubeStream;
  close(): void;
}
type GeneratedClient = YoutubeStreamClient & {
  StreamList: YoutubeStreamClient["StreamList"] & {
    requestSerialize(request: StreamRequest): Buffer;
    requestDeserialize(bytes: Buffer): StreamRequest;
  };
};
export function makeGrpcClient(): GeneratedClient {
  const defs = loadSync(
    fileURLToPath(
      new URL("../../../vendor/youtube/stream_list.proto", import.meta.url),
    ),
    {
      keepCase: true,
      enums: String,
      longs: String,
      defaults: false,
      oneofs: true,
    },
  );
  const pkg = grpc.loadPackageDefinition(defs) as unknown as {
    youtube: {
      api: {
        v3: {
          V3DataLiveChatMessageService: new (
            address: string,
            credentials: grpc.ChannelCredentials,
            options: grpc.ClientOptions,
          ) => GeneratedClient;
        };
      };
    };
  };
  return new pkg.youtube.api.v3.V3DataLiveChatMessageService(
    "youtube.googleapis.com:443",
    grpc.credentials.createSsl(),
    { "grpc.max_receive_message_length": 4 * 1024 * 1024 },
  );
}

/** One stream owns its client; refresh, cancellation and consumer errors cannot leak it. */
export async function receiveYoutubeStream(
  request: { chat: string; cursor?: string; access?: () => Promise<string> },
  signal: AbortSignal,
  receive: (batch: unknown) => "continue" | "end",
  createClient: () => YoutubeStreamClient = makeGrpcClient,
): Promise<"closed" | "end"> {
  if (signal.aborted) return "closed";
  const metadata = new grpc.Metadata();
  if (request.access)
    metadata.set("authorization", `Bearer ${await request.access()}`);
  else if (process.env.YOUTUBE_ACCESS_TOKEN)
    metadata.set("authorization", `Bearer ${process.env.YOUTUBE_ACCESS_TOKEN}`);
  else metadata.set("x-goog-api-key", process.env.YOUTUBE_API_KEY ?? "");
  // Do not allocate a client or start a stream after an asynchronous refresh was canceled.
  if (signal.aborted) return "closed";
  const client = createClient();
  let stream: YoutubeStream | undefined;
  let canceled = false;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    client.close();
  };
  const cancel = () => {
    if (canceled || !stream) return;
    canceled = true;
    try {
      stream.cancel();
    } catch {
      /* Client closure below still releases transport resources. */
    }
  };
  const abort = () => {
    cancel();
    close();
  };
  try {
    if (signal.aborted) return "closed";
    stream = client.StreamList(
      {
        live_chat_id: request.chat,
        part: ["id", "snippet", "authorDetails"],
        ...(request.cursor ? { page_token: request.cursor } : {}),
      },
      metadata,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return "closed";
    for await (const batch of stream) {
      if (signal.aborted) return "closed";
      if (receive(batch) === "end") return "end";
    }
    return "closed";
  } finally {
    signal.removeEventListener("abort", abort);
    try {
      cancel();
    } finally {
      close();
    }
  }
}
