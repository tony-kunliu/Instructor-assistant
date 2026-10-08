import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openTestD1 } from "../lib/db.ts";
import { PaperImportError, createLearner, createLesson, findInstructorByEmail, getTotals, importPaperLessons, setLearnerArchived, ValidationError } from "../lib/repo.ts";
import { PAPER_CSV_COLUMNS } from "../lib/paper-import.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import { listOutboxRowsForLearner } from "../lib/integration/outbox.ts";
import type { IntegrationHooks } from "../lib/integration/types.ts";
import type { D1Database } from "../lib/d1-types.ts";
import { handle } from "../lib/api.ts";
import { matchesReceiverSemantics, matchesSchema } from "./helpers/schema-validate.ts";

const SIG = "data:image/png;base64,iVBORw0KGgoAAAA1";
const TONY_EMAIL = "Kunliu.work@gmail.com";
const schema = JSON.parse(readFileSync(new URL("../docs/integrations/lesson-upserted-v1.schema.json", import.meta.url), "utf8"));

const HEADER = PAPER_CSV_COLUMNS.join(",");
const CSV = [
  HEADER,
  "2026-01-01,09:00,10:00,100,120,1;2,3,4,Civic,first,on_paper,Tony",
  "2026-01-02,,,,,5,,,,,unsigned,Tony",
  "2026-01-03,10:00,10:30,130,145,,1,,,,on_paper,Tony",
].join("\n") + "\n";

async function setup() {
  const db = openTestD1(":memory:");
  const tony = (await findInstructorByEmail(db, TONY_EMAIL))!;
  const learner = await createLearner(db, { fullName: "QA Paper Learner", instructorId: tony.id });
  return { db, learner, tony };
}
async function count(db: D1Database, table: string, learnerId?: string): Promise<number> {
  const row = learnerId
    ? await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE learner_id = ?`).bind(learnerId).first<{ n: number }>()
    : await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return Number(row?.n);
}
const lessonInput = (extra = {}) => ({ lessonDate: "2026-02-01", startTime: "09:00", finishTime: "10:00", startOdometer: "150", finishOdometer: "170", adiSignature: SIG, learnerSignature: SIG, taughtIds: [], assessedIds: [], achievedResults: {}, ...extra });
function hooks(): { hooks: IntegrationHooks; settle: () => Promise<void> } {
  const pending: Promise<void>[] = [];
  const h: IntegrationHooks = {
    config: resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: "synthetic", ACTGDS_INTEGRATION_ENV: "staging" }),
    fetchImpl: (async () => new Response("{}", { status: 200 })) as typeof fetch,
    schedule: (attempt) => pending.push(attempt()),
  };
  return { hooks: h, settle: async () => { await Promise.all(pending); } };
}

test("preview writes nothing", async () => {
  const { db, learner } = await setup();
  const result = await importPaperLessons(db, learner.id, CSV, "preview");
  assert.equal(result.mode, "preview");
  assert.equal(result.preview.lessonCount, 3);
  assert.equal(await count(db, "lessons"), 0);
  assert.equal(await count(db, "competency_events"), 0);
});

test("commit writes lessons 1..N as paper_import with derived values, events, and no outbox rows", async () => {
  const { db, learner, tony } = await setup();
  const result = await importPaperLessons(db, learner.id, CSV, "commit");
  assert.deepEqual(result.mode === "commit" && result.lessonCount, 3);
  const rows = (await db.prepare("SELECT * FROM lessons WHERE learner_id = ? ORDER BY lesson_no").bind(learner.id).all<Record<string, unknown>>()).results;
  assert.deepEqual(rows.map((r) => r.lesson_no), [1, 2, 3]);
  assert.ok(rows.every((r) => r.record_source === "paper_import" && r.adi_signature === null && r.learner_signature === null && r.instructor_id === tony.id));
  assert.deepEqual(rows.map((r) => r.signature_status), ["on_paper", "unsigned", "on_paper"]);
  assert.deepEqual(rows.map((r) => r.duration_minutes), [60, null, 30]);
  assert.deepEqual(rows.map((r) => r.distance_km), [20, null, 15]);
  assert.deepEqual(rows.map((r) => r.cumulative_minutes), [60, 60, 90]);
  assert.deepEqual(rows.map((r) => r.cumulative_km), [20, 20, 35]);
  assert.equal(rows[0].taught, "1, 2");
  assert.equal(rows[0].location, "Civic");
  // lesson 1: 2 taught + 2 assessed; lesson 2: 1 taught; lesson 3: 1 assessed = 6
  assert.equal(await count(db, "competency_events", learner.id), 6);
  const failed = await db.prepare("SELECT result FROM competency_events WHERE competency_id = '4'").first<{ result: string }>();
  assert.equal(failed?.result, "not_achieved");
  assert.equal(await count(db, "integration_outbox"), 0);
});

test("commit with integration hooks enabled still writes zero outbox rows", async () => {
  const { db, learner } = await setup();
  const { settle } = hooks();
  await importPaperLessons(db, learner.id, CSV, "commit");
  await settle();
  assert.deepEqual(await listOutboxRowsForLearner(db, learner.id), []);
});

test("learner with an existing lesson is rejected", async () => {
  const { db, learner } = await setup();
  await createLesson(db, learner.id, lessonInput());
  await assert.rejects(importPaperLessons(db, learner.id, CSV, "commit"), (e) => e instanceof ValidationError && e.message === "Paper records can only be imported into a learner with no lessons.");
  await assert.rejects(importPaperLessons(db, learner.id, CSV, "preview"), ValidationError);
});

test("second commit is rejected and writes nothing", async () => {
  const { db, learner } = await setup();
  await importPaperLessons(db, learner.id, CSV, "commit");
  const events = await count(db, "competency_events");
  await assert.rejects(importPaperLessons(db, learner.id, CSV, "commit"), ValidationError);
  assert.equal(await count(db, "lessons", learner.id), 3);
  assert.equal(await count(db, "competency_events"), events);
});

test("commit fails atomically if a lesson appeared after the guard read", async () => {
  const { db, learner } = await setup();
  const racing: D1Database = {
    prepare: (q: string) => db.prepare(q),
    exec: (q: string) => db.exec(q),
    batch: async (statements) => {
      await createLesson(db, learner.id, lessonInput()); // lands between guard read and batch
      return db.batch(statements);
    },
  };
  await assert.rejects(importPaperLessons(racing, learner.id, CSV, "commit"), ValidationError);
  assert.equal(await count(db, "lessons", learner.id), 1);
  assert.equal(await count(db, "lessons") - (await count(db, "lessons", learner.id)), 0);
  const paper = await db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE record_source = 'paper_import'").first<{ n: number }>();
  assert.equal(paper?.n, 0);
  assert.equal(await count(db, "competency_events", learner.id), 0);
});

test("after import the next App lesson is N+1 with cumulative including paper totals and prefill from the latest non-NULL finish", async () => {
  const { db, learner } = await setup();
  await importPaperLessons(db, learner.id, CSV, "commit");
  const totals = await getTotals(db, learner.id);
  assert.equal(totals.lessonCount, 3);
  assert.equal(totals.lastFinishOdometer, 145);
  const lesson = await createLesson(db, learner.id, lessonInput({ startOdometer: "145", finishOdometer: "160" }));
  assert.equal(lesson.lessonNo, 4);
  assert.equal(lesson.cumulativeMinutes, 90 + 60);
  assert.equal(lesson.cumulativeKm, 35 + 15);
});

test("after import with integration enabled the next App lesson event is N+1, includes paper progress and validates against the schema", async () => {
  const { db, learner } = await setup();
  const { hooks: h, settle } = hooks();
  await importPaperLessons(db, learner.id, CSV, "commit");
  await createLesson(db, learner.id, lessonInput({ startOdometer: "145", finishOdometer: "160", taughtIds: ["6"] }), h);
  await settle();
  const rows = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(rows.length, 1);
  const payload = JSON.parse(rows[0].payloadJson);
  assert.equal(payload.lesson.lesson_number, 4);
  assert.equal(payload.lesson.cumulative_minutes, 150);
  assert.equal(payload.lesson.cumulative_km, 50);
  assert.equal(payload.progress.achieved_count, 2);
  assert.equal(matchesSchema(payload, schema), true);
  assert.equal(matchesReceiverSemantics(payload), true);
});

test("archived learner can still be imported into", async () => {
  const { db, learner } = await setup();
  await setLearnerArchived(db, learner.id, true);
  const result = await importPaperLessons(db, learner.id, CSV, "commit");
  assert.equal(result.mode, "commit");
});

test("invalid CSV throws PaperImportError with rows; oversize and unknown learner are rejected", async () => {
  const { db, learner } = await setup();
  await assert.rejects(importPaperLessons(db, learner.id, CSV.replace("on_paper,Tony", "nope,Tony"), "preview"), (e) => e instanceof PaperImportError && e.errors[0].row === 2);
  await assert.rejects(importPaperLessons(db, learner.id, "x".repeat(512 * 1024 + 1), "preview"), (e) => e instanceof ValidationError && e.message === "File is too large.");
  await assert.rejects(importPaperLessons(db, "missing", CSV, "preview"), /not found/i);
});

test("handle maps PaperImportError to 400 with rows", async () => {
  const res = await handle(() => { throw new PaperImportError([{ row: 2, message: "bad" }]); });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Import has errors.", rows: [{ row: 2, message: "bad" }] });
});
