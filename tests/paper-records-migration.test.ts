import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { openTestD1 } from "../lib/db.ts";
import { getTotals } from "../lib/repo.ts";

const sql = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const OLD = ["0001_init.sql", "0002_add_competency_events.sql", "0003_add_lesson_updated_at.sql", "0004_instructor_identity.sql", "0005_integration_outbox.sql"];

/** DB built from migrations 0001–0005 only, with FK enforcement on like lib/db.ts. */
function oldDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of OLD) db.exec(sql(f));
  return db;
}

/** D1 applies each migration as one transaction. */
function apply0006(db: DatabaseSync): void {
  db.exec(`BEGIN;\n${sql("0006_paper_records.sql")}\nCOMMIT;`);
}

const INSERT_LESSON = `INSERT INTO lessons (id, learner_id, instructor_id, lesson_no, lesson_date, start_time, finish_time,
  start_odometer, finish_odometer, duration_minutes, distance_km, cumulative_minutes, cumulative_km,
  taught, competencies_assessed, achieved, location, comments, adi_signature, learner_signature, updated_at, updated_by_instructor_id)
  VALUES (?, 'L1', 'a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01', ?, '2026-01-0' || ?, '09:00', '10:00', 100, 120, 60, 20, ?, ?,
  '1', '1', '1', 'Canberra', 'ok', 'adi-sig', 'learner-sig', ?, ?)`;

function seeded(): DatabaseSync {
  const db = oldDb();
  db.prepare("INSERT INTO learners (id, instructor_id, full_name) VALUES ('L1', 'a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01', 'QA Learner')").run();
  db.prepare(INSERT_LESSON).run("les1", 1, 1, 60, 20, null, null);
  db.prepare(INSERT_LESSON).run("les2", 2, 2, 120, 40, "2026-02-01T00:00:00.000Z", "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02");
  for (const id of ["les1", "les2"]) {
    db.prepare("INSERT INTO competency_events (id, learner_id, lesson_id, competency_id, action) VALUES (?, 'L1', ?, '1', 'taught')").run(`ev-${id}`, id);
  }
  return db;
}

test("0006 preserves existing lessons", () => {
  const db = seeded();
  const before = db.prepare("SELECT * FROM lessons ORDER BY lesson_no").all();
  apply0006(db);
  const after = db.prepare("SELECT * FROM lessons ORDER BY lesson_no").all() as Record<string, unknown>[];
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    const { record_source, signature_status, ...rest } = after[i];
    assert.equal(record_source, "app");
    assert.equal(signature_status, "digital");
    assert.deepEqual({ ...rest }, { ...before[i] });
  }
  assert.equal((after[1] as Record<string, unknown>).updated_by_instructor_id, "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02");
  const joined = db.prepare("SELECT l.lesson_no FROM competency_events e JOIN lessons l ON l.id = e.lesson_id ORDER BY l.lesson_no").all();
  assert.equal(joined.length, 2);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  // The rebuilt table is still the FK parent of competency_events.
  assert.throws(() => db.prepare("DELETE FROM lessons WHERE id = 'les1'").run(), /FOREIGN KEY/);
});

test("0006 allows NULL time/odometer/duration/distance", () => {
  const db = seeded();
  apply0006(db);
  db.prepare(
    `INSERT INTO lessons (id, learner_id, instructor_id, lesson_no, lesson_date, start_time, finish_time, start_odometer, finish_odometer,
       duration_minutes, distance_km, cumulative_minutes, cumulative_km, record_source, signature_status)
     VALUES ('p1', 'L1', 'a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01', 3, '2026-03-01', NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 'paper_import', 'on_paper')`,
  ).run();
  const row = db.prepare("SELECT * FROM lessons WHERE id = 'p1'").get() as Record<string, unknown>;
  for (const k of ["start_time", "finish_time", "start_odometer", "finish_odometer", "duration_minutes", "distance_km"]) assert.equal(row[k], null);
  assert.equal(row.record_source, "paper_import");
  assert.equal(row.signature_status, "on_paper");
});

test("0006 CHECK constraints", () => {
  const db = seeded();
  apply0006(db);
  assert.throws(() => db.prepare("UPDATE lessons SET record_source = 'x' WHERE id = 'les1'").run(), /CHECK/);
  assert.throws(() => db.prepare("UPDATE lessons SET signature_status = 'x' WHERE id = 'les1'").run(), /CHECK/);
});

test("0006 keeps UNIQUE (learner_id, lesson_no)", () => {
  const db = seeded();
  apply0006(db);
  assert.throws(() => db.prepare(INSERT_LESSON).run("dup", 1, 1, 60, 20, null, null), /UNIQUE/);
});

test("getTotals lastFinishOdometer skips NULL", async () => {
  const db = openTestD1(":memory:");
  await db.prepare("INSERT INTO learners (id, instructor_id, full_name) VALUES ('L1', 'a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01', 'QA Learner')").run();
  const ins = (id: string, no: number, finish: number | null, dur: number | null, km: number | null) =>
    db
      .prepare(
        `INSERT INTO lessons (id, learner_id, instructor_id, lesson_no, lesson_date, start_odometer, finish_odometer, duration_minutes, distance_km, cumulative_minutes, cumulative_km)
         VALUES (?, 'L1', 'a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01', ?, '2026-01-01', NULL, ?, ?, ?, 0, 0)`,
      )
      .bind(id, no, finish, dur, km)
      .run();
  await ins("a", 1, 120, 60, 20);
  await ins("b", 2, null, null, null);
  const totals = await getTotals(db, "L1");
  assert.equal(totals.lastFinishOdometer, 120);
  assert.equal(totals.totalMinutes, 60);
  assert.equal(totals.totalKm, 20);
  assert.equal(totals.lessonCount, 2);
});
