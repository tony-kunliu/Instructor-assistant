import { handle, readJsonWithActor } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { createLesson, getCompletionSummary, getLearnerProgress, getTotals } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const db = getD1();
    const lesson = await createLesson(db, id, await readJsonWithActor(request));
    const { adiSignature: _adi, learnerSignature: _learner, ...summary } = lesson;
    const [totals, progress, completion] = await Promise.all([getTotals(db, id), getLearnerProgress(db, id), getCompletionSummary(db, id)]);
    return { lesson: summary, totals, progress, completion };
  }, 201);
}
