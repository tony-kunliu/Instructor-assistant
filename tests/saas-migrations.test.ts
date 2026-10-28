import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { openSaasTestD1, openTestD1 } from "../lib/db.ts";
import type { D1Database } from "../lib/d1-types.ts";

// SaaS edition (spec docs/superpowers/specs/2026-10-21-saas-edition-design.md §6):
// migrations-saas/ = byte copy of every shared migrations/ file + SaaS-only 9xxx files.

const privateDir = new URL("../migrations/", import.meta.url);
const saasDir = new URL("../migrations-saas/", import.meta.url);
const filesIn = (dir: URL) => readdirSync(dir).sort();

async function indexExists(db: D1Database, name: string): Promise<boolean> {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").bind(name).first();
  return row !== null;
}

test("migrations-saas mirrors every migrations/ file byte for byte; extra files are SaaS-only 9xxx", () => {
  const shared = filesIn(privateDir);
  const saas = filesIn(saasDir);
  assert.ok(shared.length > 0);
  for (const name of shared) {
    assert.ok(saas.includes(name), `migrations-saas/${name} is missing`);
    assert.ok(
      readFileSync(new URL(name, privateDir)).equals(readFileSync(new URL(name, saasDir))),
      `migrations-saas/${name} differs from migrations/${name}`,
    );
  }
  for (const name of saas.filter((n) => !shared.includes(n))) {
    assert.match(name, /^9\d{3}_/, `unexpected file migrations-saas/${name}`);
  }
});

test("SaaS DB: no seed instructors, no unique-name index, unique e-mail index", async () => {
  const db = openSaasTestD1();
  const count = await db.prepare("SELECT COUNT(*) AS n FROM instructors").first<{ n: number }>();
  assert.equal(count?.n, 0);
  assert.equal(await indexExists(db, "instructors_name_idx"), false);
  assert.equal(await indexExists(db, "instructors_email_idx"), true);
});

test("SaaS DB: two instructors may share a name; e-mail is unique case-insensitively", async () => {
  const db = openSaasTestD1();
  const insert = "INSERT INTO instructors (id, full_name, email) VALUES (?, ?, ?)";
  await db.prepare(insert).bind("qa-1", "QA Same Name", "qa.one@x.test").run();
  await db.prepare(insert).bind("qa-2", "QA Same Name", "qa.two@x.test").run();
  await db.prepare(insert).bind("qa-3", "QA Upper", "QA@x.test").run();
  await assert.rejects(db.prepare(insert).bind("qa-4", "QA Lower", "qa@x.test").run());
});

test("private DB is untouched: openTestD1 still has the unique name index", async () => {
  const db = openTestD1(":memory:");
  assert.equal(await indexExists(db, "instructors_name_idx"), true);
  assert.equal(await indexExists(db, "instructors_email_idx"), false);
});
