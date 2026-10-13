// Migration 0013: six additive nullable columns on learners, applied on top of 0001-0012 with existing data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION } from "../lib/schema.ts";

const sql = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const TONY = "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01";
const NEW_COLUMNS = ["other_licence_kind", "other_licence_place", "other_licence_number", "other_licence_class", "other_licence_issued_on", "other_licence_expires_on"];

function dbAfter0012(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter((n) => /^00(0[1-9]|1[012])_/.test(n)).sort()) db.exec(sql(f));
  db.prepare("INSERT INTO learners (id, instructor_id, full_name, address, address_suburb, address_state, address_postcode, phone, dob, licence_expiry, learner_licence_issued_on, logged_hours, logged_hours_on) VALUES ('L1', ?, 'QA Other Licence Learner', '44 Appleford Av, Jacka ACT 2914', 'Jacka', 'ACT', '2914', '0400 000 000', '2008-05-06', '2031-03-01', '2026-03-01', 12, '2026-10-01')").run(TONY);
  db.prepare("INSERT INTO learner_revisions (id, learner_id, revision_no, edited_at, snapshot_json) VALUES ('R1', 'L1', 1, '2026-01-02T00:00:00.000Z', '{\"fullName\":\"Old\"}')").run();
  db.prepare("INSERT INTO learner_transfer_events (id, learner_id, from_instructor_id, to_instructor_id, at) VALUES ('T1', 'L1', ?, 'a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02', '2026-01-03T00:00:00.000Z')").run(TONY);
  db.prepare("INSERT INTO learner_archive_events (id, learner_id, action, at) VALUES ('A1', 'L1', 'archived', '2026-01-04T00:00:00.000Z')").run();
  return db;
}

test("0013 only appends six nullable TEXT columns to learners; existing rows and other tables are untouched, new columns are NULL", () => {
  assert.equal(SCHEMA_VERSION, 13);
  const db = dbAfter0012();
  const tablesBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  const indexesBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name").all();
  const columnsBefore = db.prepare("SELECT name FROM pragma_table_info('learners') ORDER BY cid").all().map((r) => r.name as string);
  const learnersBefore = db.prepare("SELECT * FROM learners").all();
  db.exec(`BEGIN;\n${sql("0013_learner_other_licence.sql")}\nCOMMIT;`);
  const tablesAfter = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  assert.equal(tablesAfter.length, tablesBefore.length);
  assert.deepEqual(tablesAfter.filter((t) => t.name !== "learners"), tablesBefore.filter((t) => t.name !== "learners"));
  assert.deepEqual(db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name").all(), indexesBefore, "no index touched");
  const info = db.prepare("SELECT name, type, \"notnull\" AS nn, dflt_value AS dflt FROM pragma_table_info('learners') ORDER BY cid").all();
  assert.deepEqual(info.map((c) => c.name), [...columnsBefore, ...NEW_COLUMNS]);
  for (const c of info.filter((c) => NEW_COLUMNS.includes(c.name as string))) assert.deepEqual([c.type, c.nn, c.dflt], ["TEXT", 0, null], `${c.name} is nullable TEXT with no default`);
  const row = db.prepare("SELECT * FROM learners").get()!;
  for (const [key, value] of Object.entries(learnersBefore[0])) assert.equal(row[key], value, `existing column ${key} unchanged`);
  for (const column of NEW_COLUMNS) assert.equal(row[column], null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_revisions").get()!.n, 1, "revisions untouched");
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_transfer_events").get()!.n, 1, "transfer events untouched");
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_archive_events").get()!.n, 1, "archive events untouched");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  // The migration file is ALTER TABLE ... ADD COLUMN only: no UPDATE, DEFAULT, backfill, DROP or CREATE.
  const statements = sql("0013_learner_other_licence.sql").replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
  assert.equal(statements.length, 6);
  for (const statement of statements) assert.match(statement, /^ALTER TABLE learners ADD COLUMN other_licence_[a-z_]+ TEXT$/);
});

test("0013 re-apply is refused by SQLite (duplicate column), leaving the data intact: wrangler records applied migrations so it runs once", () => {
  const db = dbAfter0012();
  db.exec(sql("0013_learner_other_licence.sql"));
  assert.throws(() => db.exec(sql("0013_learner_other_licence.sql")), /duplicate column name/);
  db.prepare("UPDATE learners SET other_licence_kind = 'interstate', other_licence_place = 'NSW', other_licence_number = 'QA NSW 1', other_licence_class = 'learner', other_licence_issued_on = '2025-10-13', other_licence_expires_on = '2030-10-13' WHERE id = 'L1'").run();
  assert.deepEqual({ ...db.prepare("SELECT other_licence_kind AS k, other_licence_place AS p, other_licence_class AS c, other_licence_issued_on AS i FROM learners WHERE id = 'L1'").get() }, { k: "interstate", p: "NSW", c: "learner", i: "2025-10-13" });
  assert.equal(db.prepare("SELECT count(*) AS n FROM learners").get()!.n, 1);
  // "No" clears the details to NULL (the exact UPDATE shape lib/repo.ts#updateLearner issues).
  db.prepare("UPDATE learners SET other_licence_kind = 'none', other_licence_place = NULL, other_licence_number = NULL, other_licence_class = NULL, other_licence_issued_on = NULL, other_licence_expires_on = NULL WHERE id = 'L1'").run();
  assert.deepEqual({ ...db.prepare("SELECT other_licence_kind AS k, other_licence_place AS p, other_licence_class AS c FROM learners WHERE id = 'L1'").get() }, { k: "none", p: null, c: null });
});
