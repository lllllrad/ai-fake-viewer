import { test } from "node:test";
import assert from "node:assert/strict";
import {
  receiveYoutubeStream,
  type YoutubeStream,
  type YoutubeStreamClient,
} from "../packages/infrastructure/platforms/youtube-grpc.ts";
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture(stream?: YoutubeStream) {
  const controller = new AbortController();
  let created = 0,
    opened = 0,
    closed = 0,
    canceled = 0;
  const client: YoutubeStreamClient = {
    StreamList: (request, metadata) => {
      opened++;
      assert.deepEqual(request, {
        live_chat_id: "chat",
        part: ["id", "snippet", "authorDetails"],
        page_token: "cursor",
      });
      assert.deepEqual(metadata.get("authorization"), ["Bearer token"]);
      return (
        stream ?? {
          async *[Symbol.asyncIterator]() {
            yield { items: [] };
          },
          cancel: () => {
            canceled++;
          },
        }
      );
    },
    close: () => {
      closed++;
    },
  };
  const factory = () => {
    created++;
    return client;
  };
  const request = {
    chat: "chat",
    cursor: "cursor",
    access: async () => "token",
  };
  return {
    controller,
    client,
    factory,
    request,
    get created() {
      return created;
    },
    get opened() {
      return opened;
    },
    get closed() {
      return closed;
    },
    get canceled() {
      return canceled;
    },
  };
}

test("YouTube stream authenticates, resumes cursor and releases client on normal completion", async () => {
  const f = fixture();
  let batches = 0;
  const result = await receiveYoutubeStream(
    f.request,
    f.controller.signal,
    () => {
      batches++;
      return "continue";
    },
    f.factory,
  );
  assert.equal(result, "closed");
  assert.equal(batches, 1);
  assert.equal(f.canceled, 1);
  assert.equal(f.closed, 1);
});

test("YouTube stream allocates no client after abort during credential refresh", async () => {
  const f = fixture(),
    token = deferred<string>();
  f.request.access = () => token.promise;
  const running = receiveYoutubeStream(
    f.request,
    f.controller.signal,
    () => "continue",
    f.factory,
  );
  f.controller.abort();
  token.resolve("token");
  assert.equal(await running, "closed");
  assert.equal(f.created, 0);
});

test("YouTube credential refresh failure does not allocate a client", async () => {
  const f = fixture(),
    error = Error("refresh failed");
  f.request.access = async () => {
    throw error;
  };
  await assert.rejects(
    receiveYoutubeStream(
      f.request,
      f.controller.signal,
      () => "continue",
      f.factory,
    ),
    error,
  );
  assert.equal(f.created, 0);
});

test("YouTube synchronous stream creation failure still closes its client", async () => {
  const f = fixture(),
    error = Object.assign(Error("stream setup"), { code: 14 });
  f.client.StreamList = () => {
    throw error;
  };
  await assert.rejects(
    receiveYoutubeStream(
      f.request,
      f.controller.signal,
      () => "continue",
      f.factory,
    ),
    error,
  );
  assert.equal(f.closed, 1);
});

test("YouTube consumer end and consumer failure both retire the stream", async () => {
  for (const fail of [true, false]) {
    const f = fixture(),
      error = Error("ingestion failed");
    const running = receiveYoutubeStream(
      f.request,
      f.controller.signal,
      () => {
        if (fail) throw error;
        return "end";
      },
      f.factory,
    );
    if (fail) await assert.rejects(running, error);
    else assert.equal(await running, "end");
    assert.equal(f.canceled, 1);
    assert.equal(f.closed, 1);
    f.controller.abort();
    assert.equal(f.closed, 1);
  }
});

test("YouTube abort cancels idle stream and discards a late batch exactly once", async () => {
  const next = deferred<IteratorResult<unknown>>();
  let canceled = 0,
    delivered = 0;
  const stream: YoutubeStream = {
    [Symbol.asyncIterator]: () => ({ next: () => next.promise }),
    cancel: () => {
      canceled++;
      next.resolve({ done: false, value: { items: [] } });
    },
  };
  const f = fixture(stream);
  const running = receiveYoutubeStream(
    f.request,
    f.controller.signal,
    () => {
      delivered++;
      return "continue";
    },
    f.factory,
  );
  await flush();
  f.controller.abort();
  assert.equal(f.closed, 1);
  assert.equal(await running, "closed");
  assert.equal(delivered, 0);
  assert.equal(canceled, 1);
  assert.equal(f.closed, 1);
});

test("YouTube stream iteration error preserves upstream code and releases resources", async () => {
  const error = Object.assign(Error("quota"), { code: 8 });
  let canceled = 0;
  const f = fixture({
    async *[Symbol.asyncIterator]() {
      throw error;
    },
    cancel: () => {
      canceled++;
    },
  });
  await assert.rejects(
    receiveYoutubeStream(
      f.request,
      f.controller.signal,
      () => "continue",
      f.factory,
    ),
    error,
  );
  assert.equal(canceled, 1);
  assert.equal(f.closed, 1);
});

test("YouTube stream cancellation error cannot skip client closure", async () => {
  const f = fixture({
    async *[Symbol.asyncIterator]() {},
    cancel: () => {
      throw Error("cancel failed");
    },
  });
  assert.equal(
    await receiveYoutubeStream(
      f.request,
      f.controller.signal,
      () => "continue",
      f.factory,
    ),
    "closed",
  );
  assert.equal(f.closed, 1);
});
