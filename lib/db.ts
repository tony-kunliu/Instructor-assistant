import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";

/** Open (and migrate) a database. Use ":memory:" in tests. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA_SQL);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return db;
}

const globalForDb = globalThis as typeof globalThis & { __actgdsDriverDb?: DatabaseSync };

/** Shared app database (cached across dev hot reloads). */
export function getDb(): DatabaseSync {
  if (!globalForDb.__actgdsDriverDb) {
    const file = process.env.ACTGDS_DRIVER_DB || path.join(process.cwd(), "data", "actgds-driver.sqlite");
    globalForDb.__actgdsDriverDb = openDatabase(file);
  }
  return globalForDb.__actgdsDriverDb;
}
