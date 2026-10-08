// Migration 0007: additive lesson_revisions table, applied on top of 0001-0006 with existing data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const TONY = "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01";

function dbAfter0006(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter((n) => /^000[1-6]/.test(n)).sort()) db.exec(sql(f));
  db.prepare("INSERT INTO learners (id, instructor_id, full_name) VALUES ('L1', ?, 'QA Revision Learner')").run(TONY);
  db.prepare(
    `INSERT INTO lessons (id, learner_id, instructor_id, lesson_no, lesson_date, start_time, finish_time, start_odometer, finish_odometer, duration_minutes, distance_km, cumulative_minutes, cumulative_km)
     VALUES ('les1', 'L1', ?, 1, '2026-01-01', '09:00', '10:00', 100, 120, 60, 20, 60, 20)`,
  ).run(TONY);
  return db;
}

test("0007 leaves every existing table and row untouched and only adds lesson_revisions + its index", () => {
  const db = dbAfter0006();
  const tablesBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  const lessonsBefore = db.prepare("SELECT * FROM lessons").all();
  db.exec(`BEGIN;\n${sql("0007_lesson_revisions.sql")}\nCOMMIT;`);
  const tablesAfter = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  assert.deepEqual(tablesAfter.filter((t) => t.name !== "lesson_revisions"), tablesBefore);
  assert.equal(tablesAfter.length, tablesBefore.length + 1);
  assert.deepEqual(db.prepare("SELECT * FROM lessons").all(), lessonsBefore);
  assert.equal(db.prepare("SELECT count(*) AS n FROM lesson_revisions").get()!.n, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const columns = db.prepare("SELECT name FROM pragma_table_info('lesson_revisions') ORDER BY cid").all().map((r) => r.name);
  assert.deepEqual(columns, ["id", "lesson_id", "revision_no", "edited_at", "edited_by_instructor_id", "reason", "snapshot_json"]);
  const indexed = db.prepare("SELECT name FROM pragma_index_list('lesson_revisions')").all().map((r) => r.name);
  assert.ok(indexed.includes("lesson_revisions_lesson_idx"));
});

test("0007 enforces the lesson foreign key and unique (lesson_id, revision_no)", () => {
  const db = dbAfter0006();
  db.exec(sql("0007_lesson_revisions.sql"));
  const insert = db.prepare("INSERT INTO lesson_revisions (id, lesson_id, revision_no, edited_at, snapshot_json) VALUES (?, ?, ?, '2026-01-02T00:00:00.000Z', '{}')");
  assert.throws(() => insert.run("r0", "missing", 1), /FOREIGN KEY/);
  insert.run("r1", "les1", 1);
  assert.throws(() => insert.run("r2", "les1", 1), /UNIQUE/);
  insert.run("r3", "les1", 2);
});
