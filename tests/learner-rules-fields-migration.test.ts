// Migration 0009: five additive nullable columns on learners, applied on top of 0001-0008 with existing data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const TONY = "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01";
const NEW_COLUMNS = ["learner_licence_issued_on", "learner_licence_first_issued_on", "hpt_passed_on", "logged_hours", "logged_hours_on"];

function dbAfter0008(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter((n) => /^000[1-8]/.test(n)).sort()) db.exec(sql(f));
  db.prepare("INSERT INTO learners (id, instructor_id, full_name, phone, licence_expiry) VALUES ('L1', ?, 'QA Rules Learner', '0400 000 000', '2027-03-01')").run(TONY);
  db.prepare("INSERT INTO learner_revisions (id, learner_id, revision_no, edited_at, snapshot_json) VALUES ('R1', 'L1', 1, '2026-01-02T00:00:00.000Z', '{\"fullName\":\"Old\"}')").run();
  return db;
}

test("0009 only appends five nullable columns to learners; existing rows and other tables are untouched, new columns are NULL", () => {
  const db = dbAfter0008();
  const tablesBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  const columnsBefore = db.prepare("SELECT name FROM pragma_table_info('learners') ORDER BY cid").all().map((r) => r.name as string);
  const learnersBefore = db.prepare("SELECT * FROM learners").all();
  db.exec(`BEGIN;\n${sql("0009_learner_rules_fields.sql")}\nCOMMIT;`);
  const tablesAfter = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  assert.equal(tablesAfter.length, tablesBefore.length);
  assert.deepEqual(tablesAfter.filter((t) => t.name !== "learners"), tablesBefore.filter((t) => t.name !== "learners"));
  const info = db.prepare("SELECT name, type, \"notnull\" AS nn, dflt_value AS dflt FROM pragma_table_info('learners') ORDER BY cid").all();
  assert.deepEqual(info.map((c) => c.name), [...columnsBefore, ...NEW_COLUMNS]);
  for (const c of info.filter((c) => NEW_COLUMNS.includes(c.name as string))) assert.deepEqual([c.nn, c.dflt], [0, null], `${c.name} is nullable with no default`);
  assert.equal(info.find((c) => c.name === "logged_hours")!.type, "INTEGER");
  const row = db.prepare("SELECT * FROM learners").get()!;
  for (const [key, value] of Object.entries(learnersBefore[0])) assert.equal(row[key], value, `existing column ${key} unchanged`);
  for (const column of NEW_COLUMNS) assert.equal(row[column], null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_revisions").get()!.n, 1, "revisions untouched");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("0009 re-apply is refused by SQLite (duplicate column), leaving the data intact: wrangler records applied migrations so it runs once", () => {
  const db = dbAfter0008();
  db.exec(sql("0009_learner_rules_fields.sql"));
  assert.throws(() => db.exec(sql("0009_learner_rules_fields.sql")), /duplicate column name/);
  db.prepare("UPDATE learners SET logged_hours = 12, logged_hours_on = '2026-10-01', hpt_passed_on = '2026-05-05', learner_licence_issued_on = '2026-01-01', learner_licence_first_issued_on = '2025-01-01' WHERE id = 'L1'").run();
  assert.equal(db.prepare("SELECT logged_hours AS h FROM learners WHERE id = 'L1'").get()!.h, 12);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learners").get()!.n, 1);
});
