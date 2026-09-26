import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sqliteAsD1 } from "./d1-sqlite.ts";
import type { D1Database } from "./d1-types.ts";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";

/**
 * The storage layer (`lib/repo.ts`) only depends on the `D1Database`
 * interface, so it runs unmodified against either backend:
 *
 *  - In a Cloudflare Worker, `getD1()` should return the real `env.DB` D1
 *    binding (see `migrations/0001_init.sql` — apply it with
 *    `wrangler d1 migrations apply DB`). Wiring the real binding in still
 *    needs Cloudflare account credentials this environment doesn't have
 *    (see STATUS.md).
 *  - Everywhere else (local `next dev`/`next start`, `npm test`) it returns
 *    a local D1-compatible adapter backed by `node:sqlite`, using the exact
 *    same schema (`migrations/0001_init.sql`, mirrored from
 *    `lib/schema.ts`), so behaviour matches D1 in both places.
 */
function openLocalDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA_SQL);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return db;
}

/** Build a fresh D1-compatible database for tests. Use ":memory:". */
export function openTestD1(file: string): D1Database {
  return sqliteAsD1(openLocalDatabase(file));
}

const globalForDb = globalThis as typeof globalThis & { __actgdsDriverD1?: D1Database };

/** Shared app database (cached across dev hot reloads). */
export function getD1(): D1Database {
  if (!globalForDb.__actgdsDriverD1) {
    const file = process.env.ACTGDS_DRIVER_DB || path.join(process.cwd(), "data", "actgds-driver.sqlite");
    globalForDb.__actgdsDriverD1 = sqliteAsD1(openLocalDatabase(file));
  }
  return globalForDb.__actgdsDriverD1;
}
