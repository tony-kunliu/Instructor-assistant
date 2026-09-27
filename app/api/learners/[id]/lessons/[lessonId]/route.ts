import { handle, readJsonWithActor } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { integrationHooksFromRequestContext } from "@/lib/integration/context.ts";
import { getLesson, getLessonCompetencySelections, getProgressExcludingLesson, getTotals, updateLesson } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

/** Full lesson including signatures, plus its structured selections and locking state for the edit form. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const { id, lessonId } = await params;
  return handle(async () => {
    const db = getD1();
    const [lesson, selections, progressExcludingThisLesson] = await Promise.all([
      getLesson(db, id, lessonId),
      getLessonCompetencySelections(db, lessonId),
      getProgressExcludingLesson(db, id, lessonId),
    ]);
    return { lesson, selections, progressExcludingThisLesson };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const { id, lessonId } = await params;
  return handle(async () => {
    const db = getD1();
    const result = await updateLesson(db, id, lessonId, await readJsonWithActor(request), integrationHooksFromRequestContext());
    const { adiSignature: _adi, learnerSignature: _learner, ...summary } = result.lesson;
    const totals = await getTotals(db, id);
    return { lesson: summary, totals, progress: result.progress, completion: result.completion, invalidated: result.invalidated };
  });
}
