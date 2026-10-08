import { handle } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { listLessonRevisions } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

/** One lesson's previous versions (oldest first), loaded lazily when History is opened for that lesson. Same middleware/Access gate as every other route. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const { id, lessonId } = await params;
  return handle(async () => ({ revisions: await listLessonRevisions(getD1(), id, lessonId) }));
}
