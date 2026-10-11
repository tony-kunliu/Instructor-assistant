// Migration 0011: additive learner_transfer_events table, applied on top of 0001-0010 with existing data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const TONY = "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01";
const ANNA = "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02";

function dbAfter0010(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter((n) => /^00(0\d|10)_/.test(n)).sort()) db.exec(sql(f));
  db.prepare("INSERT INTO learners (id, instructor_id, full_name, phone, logged_hours, logged_hours_on) VALUES ('L1', ?, 'QA Active Learner', '0400 000 000', 12, '2026-10-01')").run(TONY);
  db.prepare("INSERT INTO learners (id, instructor_id, full_name, archived_at) VALUES ('L2', ?, 'QA Archived Learner', '2026-09-01T00:00:00.000Z')").run(ANNA);
  db.prepare(
    `INSERT INTO lessons (id, learner_id, instructor_id, lesson_no, lesson_date, start_time, finish_time, start_odometer, finish_odometer, duration_minutes, distance_km, cumulative_minutes, cumulative_km, taught, adi_signature, learner_signature)
     VALUES ('S1', 'L1', ?, 1, '2026-01-05', '09:00', '10:00', 1000, 1030, 60, 30, 60, 30, '["1"]', 'sigA', 'sigL')`,
  ).run(TONY);
  db.prepare("INSERT INTO learner_revisions (id, learner_id, revision_no, edited_at, snapshot_json) VALUES ('R1', 'L1', 1, '2026-01-02T00:00:00.000Z', '{\"fullName\":\"Old\"}')").run();
  db.prepare("INSERT INTO learner_archive_events (id, learner_id, action, at, by_instructor_id) VALUES ('A1', 'L2', 'archived', '2026-09-01T00:00:00.000Z', ?)").run(ANNA);
  return db;
}

test("0011 leaves every existing table and row untouched and only adds learner_transfer_events + its index (no events invented)", () => {
  const db = dbAfter0010();
  const tablesBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  const rowsOf = (table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  const before = Object.fromEntries(["learners", "lessons", "learner_revisions", "learner_archive_events", "instructors", "integration_outbox"].map((t) => [t, rowsOf(t)]));
  db.exec(`BEGIN;\n${sql("0011_learner_transfer_events.sql")}\nCOMMIT;`);
  const tablesAfter = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  assert.deepEqual(tablesAfter.filter((t) => t.name !== "learner_transfer_events"), tablesBefore);
  assert.equal(tablesAfter.length, tablesBefore.length + 1);
  for (const [table, rows] of Object.entries(before)) assert.deepEqual(rowsOf(table), rows, `${table} unchanged`);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_transfer_events").get()!.n, 0, "no transfer is ever invented");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const columns = db.prepare("SELECT name, \"notnull\" AS nn FROM pragma_table_info('learner_transfer_events') ORDER BY cid").all().map((r) => `${r.name}${r.nn ? "!" : ""}`);
  assert.deepEqual(columns, ["id", "learner_id!", "from_instructor_id!", "to_instructor_id!", "at!", "by_instructor_id", "note", "records_checked_at", "records_checked_by"]);
  const indexColumns = db.prepare("SELECT name FROM pragma_index_info('learner_transfer_events_learner_idx') ORDER BY seqno").all().map((r) => r.name);
  assert.deepEqual(indexColumns, ["learner_id", "at"]);
});

test("0011 enforces the learner/instructor foreign keys and NOT NULLs; re-applying is harmless", () => {
  const db = dbAfter0010();
  db.exec(sql("0011_learner_transfer_events.sql"));
  db.exec(sql("0011_learner_transfer_events.sql"));
  const insert = db.prepare("INSERT INTO learner_transfer_events (id, learner_id, from_instructor_id, to_instructor_id, at, by_instructor_id, records_checked_by) VALUES (?, ?, ?, ?, '2026-10-11T00:00:00.000Z', ?, ?)");
  assert.throws(() => insert.run("t0", "missing", TONY, ANNA, null, null), /FOREIGN KEY/);
  assert.throws(() => insert.run("t1", "L1", "nobody", ANNA, null, null), /FOREIGN KEY/);
  assert.throws(() => insert.run("t2", "L1", TONY, "nobody", null, null), /FOREIGN KEY/);
  assert.throws(() => insert.run("t3", "L1", TONY, ANNA, "nobody", null), /FOREIGN KEY/);
  assert.throws(() => insert.run("t4", "L1", TONY, ANNA, null, "nobody"), /FOREIGN KEY/);
  assert.throws(() => insert.run("t5", "L1", null, ANNA, null, null), /NOT NULL/);
  insert.run("t6", "L1", TONY, ANNA, TONY, null);
  insert.run("t7", "L1", ANNA, TONY, null, ANNA);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_transfer_events").get()!.n, 2);
});
