import { localNow } from "../calc.ts";
import type { D1Database } from "../d1-types.ts";
import { listLearners, listLessonsForExport } from "../repo.ts";
import type { Scope } from "../scope.ts";
import type { Learner, Lesson } from "../types.ts";

/**
 * SaaS edition "Export my data" (spec 2026-10-21-saas-edition-design §8): everything the signed-in instructor has
 * recorded — their active and archived learners, each with all of its lessons (signatures included, as stored: they
 * are the instructor's own records) — as one JSON file. Only the instructor scope is accepted; the private edition's
 * `all` scope is refused, so this can never widen to another account's data.
 */

export type AccountExport = {
  exportedAt: string;
  instructor: { id: string; fullName: string; adiNumber: string | null };
  learners: { learner: Learner; lessons: Lesson[] }[];
};

type Row = Record<string, unknown>;

export async function buildAccountExport(db: D1Database, scope: Scope, now: Date = new Date()): Promise<AccountExport> {
  if (scope.kind !== "instructor") throw new Error("The account export needs a signed-in instructor.");
  const row = await db.prepare("SELECT id, full_name, adi_number FROM instructors WHERE id = ?").bind(scope.instructorId).first<Row>();
  if (!row) throw new Error("Instructor not found.");
  const [active, archived] = await Promise.all([listLearners(db, { archived: false, scope }), listLearners(db, { archived: true, scope })]);
  const learners: AccountExport["learners"] = [];
  for (const learner of [...active, ...archived]) learners.push({ learner, lessons: await listLessonsForExport(db, learner.id) });
  return {
    exportedAt: now.toISOString(),
    instructor: { id: String(row.id), fullName: String(row.full_name), adiNumber: row.adi_number === null || row.adi_number === undefined ? null : String(row.adi_number) },
    learners,
  };
}

/** `instructor-assistant-export-<YYYY-MM-DD>.json`, the date in Canberra time (AGENTS.md §15). */
export function accountExportFilename(now: Date): string {
  return `instructor-assistant-export-${localNow(now).date}.json`;
}
