// Local D1-compatible adapter, backed by Node's built-in `node:sqlite`.
//
// D1's on-disk format *is* SQLite, so this adapter runs the exact same SQL
// (schema + queries) a real Cloudflare D1 binding would. It exists so the
// app has a persistent, working database when it isn't running inside a
// Cloudflare Worker (local `next dev`/`next start`, and `npm test`).
//
// `lib/repo.ts` only ever talks to the `D1Database` interface (see
// `lib/d1-types.ts`) — swapping this adapter for a real `env.DB` binding in
// a Cloudflare Worker requires no change to the query/business logic.
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement, D1Result } from "./d1-types.ts";

// D1's bind() accepts string | number | null | boolean | ArrayBuffer (this
// app only ever passes string | number | null); node:sqlite's narrower
// SQLInputValue type is the same values at the wire level.
function asSqliteValues(values: unknown[]): SQLInputValue[] {
  return values as SQLInputValue[];
}

class SqlitePreparedStatement implements D1PreparedStatement {
  #db: DatabaseSync;
  #sql: string;
  #values: unknown[];

  constructor(db: DatabaseSync, sql: string, values: unknown[] = []) {
    this.#db = db;
    this.#sql = sql;
    this.#values = values;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqlitePreparedStatement(this.#db, this.#sql, values);
  }

  #statement(): StatementSync {
    return this.#db.prepare(this.#sql);
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const row = this.#statement().get(...asSqliteValues(this.#values)) as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    return (colName ? (row[colName] as T) : (row as T)) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.#statement().all(...asSqliteValues(this.#values)) as T[];
    return { results, success: true, meta: {} };
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const info = this.#statement().run(...asSqliteValues(this.#values));
    return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: info.lastInsertRowid } };
  }
}

/** Wraps a `node:sqlite` DatabaseSync as a `D1Database`. */
export function sqliteAsD1(db: DatabaseSync): D1Database {
  return {
    prepare(query: string): D1PreparedStatement {
      return new SqlitePreparedStatement(db, query);
    },
    async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      // Real D1 runs a batch as a single atomic transaction. Mirror that
      // locally so dev/test behaviour matches production.
      db.exec("BEGIN IMMEDIATE");
      try {
        const results: D1Result<T>[] = [];
        for (const statement of statements) results.push(await statement.run<T>());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(query: string): Promise<{ count: number; duration: number }> {
      db.exec(query);
      return { count: 0, duration: 0 };
    },
  };
}
