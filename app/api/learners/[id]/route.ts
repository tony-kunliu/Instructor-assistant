import { handle } from "@/lib/api.ts";
import { getDb } from "@/lib/db.ts";
import { getLearner, getTotals, listLessons } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => {
    const db = getDb();
    return { learner: getLearner(db, id), totals: getTotals(db, id), lessons: listLessons(db, id) };
  });
}
