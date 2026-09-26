// Minimal Cloudflare D1 API surface used by this project. Hand-written (no
// `@cloudflare/workers-types` dependency) to keep this a plain interface:
// any object implementing it — the real `env.DB` binding in a Cloudflare
// Worker, or the local adapter in `lib/d1-sqlite.ts` — works with `lib/repo.ts`
// unchanged.
//
// Shape matches Cloudflare's documented D1Database API:
// https://developers.cloudflare.com/d1/worker-api/

export type D1Result<T = Record<string, unknown>> = {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number | bigint; duration?: number };
};

export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
};

export type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
};
