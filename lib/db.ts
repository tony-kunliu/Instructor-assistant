import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sqliteAsD1 } from "./d1-sqlite.ts";
import type { D1Database } from "./d1-types.ts";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";

declare global {
  interface CloudflareEnv {
    DB: D1Database;
  }
}

/**
 * The storage layer (`lib/repo.ts`) only depends on the `D1Database`
 * interface, so it runs unmodified against either backend:
 *
 *  - In the deployed Cloudflare Worker (via `@opennextjs/cloudflare`),
 *    `getD1()` returns the real `env.DB` D1 binding declared in
 *    `wrangler.toml` (see `migrations/0001_init.sql`, applied with
 *    `wrangler d1 migrations apply DB --remote`).
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

/**
 * Build a fresh in-memory SaaS-edition database for tests: every
 * `migrations-saas/*.sql` applied in filename order (as `wrangler d1
 * migrations apply` does), NOT `SCHEMA_SQL` — so tests see exactly what the
 * separately deployed SaaS D1 gets (spec 2026-10-21-saas-edition-design §6).
 */
export function openSaasTestD1(): D1Database {
  const dir = new URL("../migrations-saas/", import.meta.url);
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(name, dir), "utf8"));
  }
  return sqliteAsD1(db);
}

const globalForDb = globalThis as typeof globalThis & { __actgdsDriverD1?: D1Database };

/** Shared app database (cached across dev hot reloads). */
export function getD1(): D1Database {
  try {
    const { env } = getCloudflareContext();
    if (env.DB) return env.DB;
  } catch {
    // Not running inside a Cloudflare Worker (e.g. `next build`, `npm test`) — fall through to local sqlite.
  }
  if (!globalForDb.__actgdsDriverD1) {
    const file = process.env.ACTGDS_DRIVER_DB || path.join(process.cwd(), "data", "actgds-driver.sqlite");
    globalForDb.__actgdsDriverD1 = sqliteAsD1(openLocalDatabase(file));
  }
  return globalForDb.__actgdsDriverD1;
}
