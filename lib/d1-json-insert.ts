// Set-based multi-row INSERT for Cloudflare D1.
//
// The Workers Free plan allows at most 50 D1 queries per Worker invocation,
// and every statement inside a db.batch([...]) counts. D1 also caps bound
// parameters at 100 per statement. So a write of N rows must neither be N
// statements nor bind one parameter per value: instead every row travels in
// ONE bound JSON array and SQLite unpacks it with json_each/json_extract
// (both supported by D1 and by node:sqlite). Numbers and NULLs keep their
// types through json_extract (a JSON integer comes back as INTEGER, JSON
// null as NULL, a JSON string as TEXT with its exact characters).

import type { D1Database, D1PreparedStatement } from "./d1-types.ts";

export type JsonInsertValue = string | number | null;

/** Table and column names are only ever code constants; this guards against anything else reaching the SQL text. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * One `INSERT INTO table (columns) SELECT json_extract(value, '$.column'), ... FROM json_each(?)` statement
 * for all `rows`, inserted in array order. Every row must carry every column (use null for NULL). Returns
 * null when there are no rows, so callers can leave it out of their batch. Not run here.
 */
export function jsonInsertStatement(
  db: D1Database,
  table: string,
  columns: readonly string[],
  rows: readonly Readonly<Record<string, JsonInsertValue>>[],
): D1PreparedStatement | null {
  if (rows.length === 0) return null;
  for (const name of [table, ...columns]) {
    if (!IDENTIFIER.test(name)) throw new Error(`jsonInsertStatement: invalid identifier ${JSON.stringify(name)}`);
  }
  const values = rows.map((row) =>
    Object.fromEntries(
      columns.map((column) => {
        const value = row[column];
        if (value === undefined) throw new Error(`jsonInsertStatement: row is missing column ${column}`);
        if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`jsonInsertStatement: column ${column} is not a finite number`);
        return [column, value];
      }),
    ),
  );
  const extracts = columns.map((column) => `json_extract(value, '$.${column}')`).join(", ");
  return db
    .prepare(`INSERT INTO ${table} (${columns.join(", ")}) SELECT ${extracts} FROM json_each(?) ORDER BY key`)
    .bind(JSON.stringify(values));
}
