import { handle } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { getLearner, getTotals, listLessons } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const db = getD1();
    const [learner, totals, lessons] = await Promise.all([getLearner(db, id), getTotals(db, id), listLessons(db, id)]);
    return { learner, totals, lessons };
  });
}
