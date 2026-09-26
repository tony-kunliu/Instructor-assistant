import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openTestD1 } from "../lib/db.ts";
import { SCHEMA_SQL } from "../lib/schema.ts";

test("migrations/0001+0002+0003 match lib/schema.ts (no drift between the two)", () => {
  const migrationFiles = ["0001_init.sql", "0002_add_competency_events.sql", "0003_add_lesson_updated_at.sql"];
  const migrations = migrationFiles.map((name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const normalize = (sql: string) => sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();
  assert.equal(normalize(migrations.join("\n")), normalize(SCHEMA_SQL));
});

test("D1 adapter: prepare/bind/first/all/run/batch behave like the real D1Database API", async () => {
  const db = openTestD1(":memory:");

  // run() + meta.changes
  const insert = await db.prepare("INSERT INTO instructors (id, full_name) VALUES (?, ?)").bind("i1", "Ada Instructor").run();
  assert.equal(insert.success, true);
  assert.equal(insert.meta.changes, 1);

  // first() returns a single row, or null when nothing matches
  const found = await db.prepare("SELECT full_name FROM instructors WHERE id = ?").bind("i1").first<{ full_name: string }>();
  assert.equal(found?.full_name, "Ada Instructor");
  const missing = await db.prepare("SELECT full_name FROM instructors WHERE id = ?").bind("nope").first();
  assert.equal(missing, null);

  // all() returns { results }
  await db.prepare("INSERT INTO instructors (id, full_name) VALUES (?, ?)").bind("i2", "Bea Instructor").run();
  const { results } = await db.prepare("SELECT id FROM instructors ORDER BY id").all<{ id: string }>();
  assert.deepEqual(results.map((r) => r.id), ["i1", "i2"]);

  // batch() applies all statements atomically
  const batchResults = await db.batch([
    db.prepare("INSERT INTO instructors (id, full_name) VALUES (?, ?)").bind("i3", "Cy Instructor"),
    db.prepare("INSERT INTO instructors (id, full_name) VALUES (?, ?)").bind("i4", "Di Instructor"),
  ]);
  assert.equal(batchResults.length, 2);
  const countRow = await db.prepare("SELECT COUNT(*) AS n FROM instructors").first<{ n: number }>();
  assert.equal(countRow?.n, 4);
});
