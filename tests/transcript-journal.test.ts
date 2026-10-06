import { test } from "node:test";
import assert from "node:assert/strict";
import { TranscriptJournal } from "../packages/application/inputs/transcript-journal.ts";
import { SqliteTranscripts } from "../packages/infrastructure/inputs/transcripts-sqlite.ts";
import { Store } from "../packages/storage.ts";
function fixture(t: { after(fn: () => void): void }) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const state = { session: store.sessionId, now: 200000, closed: false };
  const journal = new TranscriptJournal(new SqliteTranscripts(store.db), {
    sessionId: () => state.session,
    now: () => state.now,
    closed: () => state.closed,
  });
  const add = (id: string, capturedAt = state.now, text = "Synthetic speech") =>
    journal.record({ id, capturedAt, text });
  return { store, state, journal, add };
}
test("speech recovery is current-broadcast only and expires at the two-minute boundary", (t) => {
  const f = fixture(t);
  f.add("expired", f.state.now - 120000);
  f.add("current", f.state.now - 119999);
  f.state.session = "other";
  f.add("other");
  assert.deepEqual(
    f.journal.recent().map((t) => t.id),
    ["other"],
  );
  f.state.session = f.store.sessionId;
  assert.deepEqual(
    f.journal.recent().map((t) => t.id),
    ["current"],
  );
});
test("equal capture timestamps recover the last twelve chunks in stable insertion order", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 24; i++) f.add("chunk-" + i);
  assert.deepEqual(
    f.journal.recent().map((t) => t.id),
    Array.from({ length: 12 }, (_, i) => "chunk-" + (i + 12)),
  );
});
test("closed broadcasts admit no speech or recovery while diagnostic counts remain truthful", (t) => {
  const f = fixture(t);
  f.add("existing");
  f.state.closed = true;
  assert.equal(f.add("late"), false);
  assert.deepEqual(f.journal.recent(), []);
  assert.equal(f.journal.count(), 1);
  f.journal.clear();
  assert.equal(f.journal.count(), 0);
});
test("invalid speech and duplicate IDs cannot replace a durable transcript", (t) => {
  const f = fixture(t);
  f.add("existing");
  for (const value of [
    { id: "", capturedAt: 200000, text: "valid" },
    { id: "bad", capturedAt: NaN, text: "valid" },
    { id: "bad", capturedAt: -1, text: "valid" },
    { id: "bad", capturedAt: 200000, text: " " },
    { id: "bad", capturedAt: 200000, text: "x".repeat(1001) },
  ])
    assert.throws(() => f.journal.record(value));
  assert.throws(() => f.add("existing", 200001, "replacement"));
  assert.equal(f.journal.count(), 1);
  assert.equal(f.journal.rows()[0].text, "Synthetic speech");
  assert.throws(() => f.journal.rows(-1));
  assert.throws(() => f.journal.rows(1001));
});
test("explicit export is newline-delimited, retains broadcast provenance and clear removes every row", (t) => {
  const f = fixture(t);
  f.add("first", 100000, "First\nline");
  f.state.session = "second";
  f.add("second");
  const exported = [...f.journal.export()].join("");
  const lines = exported.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).sessionId, f.store.sessionId);
  assert.equal(JSON.parse(lines[0]).text, "First\nline");
  assert.equal(JSON.parse(lines[1]).sessionId, "second");
  assert.deepEqual(
    f.journal.rows(1).map((t) => t.id),
    ["second"],
  );
  f.journal.clear();
  assert.deepEqual([...f.journal.export()], []);
  assert.equal(f.journal.count(), 0);
});
