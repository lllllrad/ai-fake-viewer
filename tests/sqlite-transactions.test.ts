import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SqliteTransactions } from "../packages/infrastructure/storage/transactions.ts";

test("nested work cannot commit a swallowed failure or publish rolled-back effects", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE values_table(value INTEGER)");
  let value = 0,
    effects = 0;
  const transactions = new SqliteTransactions(db, () => {
    const prior = value;
    return () => {
      value = prior;
    };
  });
  try {
    assert.throws(
      () =>
        transactions.run(() => {
          value = 1;
          db.exec("INSERT INTO values_table VALUES(1)");
          try {
            transactions.run(() => {
              throw Error("nested failure");
            });
          } catch {}
          transactions.afterCommit(() => effects++);
        }),
      /nested failure/,
    );
    assert.equal(value, 0);
    assert.equal(effects, 0);
    assert.equal(db.prepare("SELECT 1 FROM values_table").get(), undefined);
    transactions.run(() => {
      value = 2;
      db.exec("INSERT INTO values_table VALUES(2)");
      transactions.afterCommit(() => effects++);
    });
    assert.equal(value, 2);
    assert.equal(effects, 1);
  } finally {
    db.close();
  }
});
test("deferred commit failure rolls back memory and SQL; notification failure never rolls back committed data", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);",
  );
  let value = 0,
    notified = false;
  const transactions = new SqliteTransactions(db, () => {
    const prior = value;
    return () => {
      value = prior;
    };
  });
  try {
    assert.throws(
      () =>
        transactions.run(() => {
          value = 1;
          db.exec("INSERT INTO child VALUES(1)");
          transactions.afterCommit(() => {
            notified = true;
          });
        }),
      /FOREIGN KEY/,
    );
    assert.equal(value, 0);
    assert.equal(notified, false);
    assert.equal(db.prepare("SELECT 1 FROM child").get(), undefined);
    assert.throws(
      () =>
        transactions.run(() => {
          value = 2;
          db.exec("INSERT INTO parent VALUES(2)");
          transactions.afterCommit(() => {
            throw Error("synthetic notification failure");
          });
          transactions.afterCommit(() => {
            notified = true;
          });
        }),
      AggregateError,
    );
    assert.equal(value, 2);
    assert.equal(notified, true);
    assert(db.prepare("SELECT 1 FROM parent WHERE id=2").get());
  } finally {
    db.close();
  }
});
