// Migration 0012: three additive nullable columns on learners, applied on top of 0001-0011 with existing data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION } from "../lib/schema.ts";

const sql = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const TONY = "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01";
const NEW_COLUMNS = ["address_suburb", "address_state", "address_postcode"];

function dbAfter0011(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter((n) => /^00(0[1-9]|1[01])_/.test(n)).sort()) db.exec(sql(f));
  db.prepare("INSERT INTO learners (id, instructor_id, full_name, address, phone, licence_expiry, logged_hours) VALUES ('L1', ?, 'QA Address Learner', '44 QA Street, Somewhere', '0400 000 000', '2027-03-01', 12)").run(TONY);
  db.prepare("INSERT INTO learner_revisions (id, learner_id, revision_no, edited_at, snapshot_json) VALUES ('R1', 'L1', 1, '2026-01-02T00:00:00.000Z', '{\"fullName\":\"Old\"}')").run();
  db.prepare("INSERT INTO learner_transfer_events (id, learner_id, from_instructor_id, to_instructor_id, at) VALUES ('T1', 'L1', ?, 'a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02', '2026-01-03T00:00:00.000Z')").run(TONY);
  return db;
}

test("0012 only appends three nullable TEXT columns to learners; existing rows and other tables are untouched, new columns are NULL", () => {
  assert.equal(SCHEMA_VERSION, 12);
  const db = dbAfter0011();
  const tablesBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  const columnsBefore = db.prepare("SELECT name FROM pragma_table_info('learners') ORDER BY cid").all().map((r) => r.name as string);
  const learnersBefore = db.prepare("SELECT * FROM learners").all();
  db.exec(`BEGIN;\n${sql("0012_learner_address_parts.sql")}\nCOMMIT;`);
  const tablesAfter = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  assert.equal(tablesAfter.length, tablesBefore.length);
  assert.deepEqual(tablesAfter.filter((t) => t.name !== "learners"), tablesBefore.filter((t) => t.name !== "learners"));
  const info = db.prepare("SELECT name, type, \"notnull\" AS nn, dflt_value AS dflt FROM pragma_table_info('learners') ORDER BY cid").all();
  assert.deepEqual(info.map((c) => c.name), [...columnsBefore, ...NEW_COLUMNS]);
  for (const c of info.filter((c) => NEW_COLUMNS.includes(c.name as string))) assert.deepEqual([c.type, c.nn, c.dflt], ["TEXT", 0, null], `${c.name} is nullable TEXT with no default`);
  const row = db.prepare("SELECT * FROM learners").get()!;
  for (const [key, value] of Object.entries(learnersBefore[0])) assert.equal(row[key], value, `existing column ${key} unchanged`);
  for (const column of NEW_COLUMNS) assert.equal(row[column], null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_revisions").get()!.n, 1, "revisions untouched");
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_transfer_events").get()!.n, 1, "transfer events untouched");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("0012 re-apply is refused by SQLite (duplicate column), leaving the data intact: wrangler records applied migrations so it runs once", () => {
  const db = dbAfter0011();
  db.exec(sql("0012_learner_address_parts.sql"));
  assert.throws(() => db.exec(sql("0012_learner_address_parts.sql")), /duplicate column name/);
  db.prepare("UPDATE learners SET address = '44 Appleford Av, Jacka ACT 2914', address_suburb = 'Jacka', address_state = 'ACT', address_postcode = '2914' WHERE id = 'L1'").run();
  assert.deepEqual({ ...db.prepare("SELECT address_suburb AS s, address_state AS st, address_postcode AS p FROM learners WHERE id = 'L1'").get() }, { s: "Jacka", st: "ACT", p: "2914" });
  assert.equal(db.prepare("SELECT count(*) AS n FROM learners").get()!.n, 1);
});
