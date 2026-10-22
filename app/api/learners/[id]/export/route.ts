import { handle } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { getLearner, listLessonsForExport, ValidationError } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

/**
 * Everything the client-side PDF export (lib/pdf-export.ts) needs in one
 * call: the learner (incl. instructor ADI number) and every saved lesson,
 * oldest first, with real signatures. Protected by the same site-wide Basic
 * Auth as every other route (see middleware.ts) — this data never leaves
 * the app to a third party.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const db = getD1();
    const [learner, lessons] = await Promise.all([getLearner(db, id), listLessonsForExport(db, id)]);
    if (learner.draftAt) throw new ValidationError("A draft learner has no record to export. Confirm the learner first.");
    return { learner, lessons };
  });
}
