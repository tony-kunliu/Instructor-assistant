// Migration 0008: additive learner_revisions table, applied on top of 0001-0007 with existing data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const TONY = "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01";

function dbAfter0007(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter((n) => /^000[1-7]/.test(n)).sort()) db.exec(sql(f));
  db.prepare("INSERT INTO learners (id, instructor_id, full_name, phone) VALUES ('L1', ?, 'QA Revision Learner', '0400 000 000')").run(TONY);
  return db;
}

test("0008 leaves every existing table and row untouched and only adds learner_revisions + its index", () => {
  const db = dbAfter0007();
  const tablesBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  const learnersBefore = db.prepare("SELECT * FROM learners").all();
  db.exec(`BEGIN;\n${sql("0008_learner_revisions.sql")}\nCOMMIT;`);
  const tablesAfter = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  assert.deepEqual(tablesAfter.filter((t) => t.name !== "learner_revisions"), tablesBefore);
  assert.equal(tablesAfter.length, tablesBefore.length + 1);
  assert.deepEqual(db.prepare("SELECT * FROM learners").all(), learnersBefore);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_revisions").get()!.n, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const columns = db.prepare("SELECT name FROM pragma_table_info('learner_revisions') ORDER BY cid").all().map((r) => r.name);
  assert.deepEqual(columns, ["id", "learner_id", "revision_no", "edited_at", "edited_by_instructor_id", "snapshot_json"]);
  const indexed = db.prepare("SELECT name FROM pragma_index_list('learner_revisions')").all().map((r) => r.name);
  assert.ok(indexed.includes("learner_revisions_learner_idx"));
});

test("0008 enforces the learner foreign key and unique (learner_id, revision_no); re-applying is harmless", () => {
  const db = dbAfter0007();
  db.exec(sql("0008_learner_revisions.sql"));
  db.exec(sql("0008_learner_revisions.sql"));
  const insert = db.prepare("INSERT INTO learner_revisions (id, learner_id, revision_no, edited_at, snapshot_json) VALUES (?, ?, ?, '2026-01-02T00:00:00.000Z', '{}')");
  assert.throws(() => insert.run("r0", "missing", 1), /FOREIGN KEY/);
  insert.run("r1", "L1", 1);
  assert.throws(() => insert.run("r2", "L1", 1), /UNIQUE/);
  insert.run("r3", "L1", 2);
});
