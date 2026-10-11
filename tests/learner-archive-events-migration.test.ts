// Migration 0010: additive learner_archive_events table, applied on top of 0001-0009 with existing data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const TONY = "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01";

function dbAfter0009(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter((n) => /^000\d/.test(n)).sort()) db.exec(sql(f));
  db.prepare("INSERT INTO learners (id, instructor_id, full_name, phone, logged_hours) VALUES ('L1', ?, 'QA Active Learner', '0400 000 000', 12)").run(TONY);
  // A learner archived BEFORE 0010: it must keep archived_at and get no invented event.
  db.prepare("INSERT INTO learners (id, instructor_id, full_name, archived_at) VALUES ('L2', ?, 'QA Archived Before', '2026-09-01T00:00:00.000Z')").run(TONY);
  db.prepare("INSERT INTO learner_revisions (id, learner_id, revision_no, edited_at, snapshot_json) VALUES ('R1', 'L1', 1, '2026-01-02T00:00:00.000Z', '{\"fullName\":\"Old\"}')").run();
  return db;
}

test("0010 leaves every existing table and row untouched and only adds learner_archive_events + its index (no events invented)", () => {
  const db = dbAfter0009();
  const tablesBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  const learnersBefore = db.prepare("SELECT * FROM learners ORDER BY id").all();
  const revisionsBefore = db.prepare("SELECT * FROM learner_revisions").all();
  db.exec(`BEGIN;\n${sql("0010_learner_archive_events.sql")}\nCOMMIT;`);
  const tablesAfter = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  assert.deepEqual(tablesAfter.filter((t) => t.name !== "learner_archive_events"), tablesBefore);
  assert.equal(tablesAfter.length, tablesBefore.length + 1);
  assert.deepEqual(db.prepare("SELECT * FROM learners ORDER BY id").all(), learnersBefore);
  assert.deepEqual(db.prepare("SELECT * FROM learner_revisions").all(), revisionsBefore);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_archive_events").get()!.n, 0, "existing archived learners get no event");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const columns = db.prepare("SELECT name, \"notnull\" AS nn FROM pragma_table_info('learner_archive_events') ORDER BY cid").all().map((r) => `${r.name}${r.nn ? "!" : ""}`);
  assert.deepEqual(columns, ["id", "learner_id!", "action!", "reason", "note", "at!", "by_instructor_id"]);
  const indexed = db.prepare("SELECT name FROM pragma_index_list('learner_archive_events')").all().map((r) => r.name);
  assert.ok(indexed.includes("learner_archive_events_learner_idx"));
  const indexColumns = db.prepare("SELECT name FROM pragma_index_info('learner_archive_events_learner_idx') ORDER BY seqno").all().map((r) => r.name);
  assert.deepEqual(indexColumns, ["learner_id", "at"]);
});

test("0010 enforces the learner/instructor foreign keys and the action CHECK; re-applying is harmless", () => {
  const db = dbAfter0009();
  db.exec(sql("0010_learner_archive_events.sql"));
  db.exec(sql("0010_learner_archive_events.sql"));
  const insert = db.prepare("INSERT INTO learner_archive_events (id, learner_id, action, reason, at, by_instructor_id) VALUES (?, ?, ?, ?, '2026-10-11T00:00:00.000Z', ?)");
  assert.throws(() => insert.run("e0", "missing", "archived", null, null), /FOREIGN KEY/);
  assert.throws(() => insert.run("e1", "L1", "archived", null, "nobody"), /FOREIGN KEY/);
  assert.throws(() => insert.run("e2", "L1", "deleted", null, null), /CHECK/);
  insert.run("e3", "L1", "archived", "moved_away", TONY);
  insert.run("e4", "L1", "restored", null, null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_archive_events").get()!.n, 2);
});
