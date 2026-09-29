import { handle, readJson } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { getCompletionSummary, getLearner, getLearnerProgress, getTotals, listLessons, setLearnerArchived, ValidationError } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const db = getD1();
    const [learner, totals, lessons, progress, completion] = await Promise.all([
      getLearner(db, id),
      getTotals(db, id),
      listLessons(db, id),
      getLearnerProgress(db, id),
      getCompletionSummary(db, id),
    ]);
    return { learner, totals, lessons, progress, completion };
  });
}

/** Archive / restore only (`{ archived: boolean }`) — same access as any other learner/lesson write: any Access-verified active instructor. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    if (typeof body.archived !== "boolean") throw new ValidationError("`archived` must be true or false.");
    return { learner: await setLearnerArchived(getD1(), id, body.archived) };
  });
}
