import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { sqliteAsD1 } from "../../lib/d1-sqlite.ts";
import type { D1Database } from "../../lib/d1-types.ts";

const SAAS_MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations-saas/", import.meta.url));

/**
 * Build a fresh in-memory SaaS-edition database for tests: every
 * `migrations-saas/*.sql` applied in filename order (as `wrangler d1
 * migrations apply` does), NOT `SCHEMA_SQL` — so tests see exactly what the
 * separately deployed SaaS D1 gets (spec 2026-10-21-saas-edition-design §6).
 * Test-only: lives under tests/ so its fs access is never bundled into the app.
 */
export function openSaasTestD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const name of readdirSync(SAAS_MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort()) {
    db.exec(readFileSync(path.join(SAAS_MIGRATIONS_DIR, name), "utf8"));
  }
  return sqliteAsD1(db);
}
