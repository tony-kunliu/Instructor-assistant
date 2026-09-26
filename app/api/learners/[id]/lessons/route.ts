import { handle, readJson } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { createLesson, getTotals } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const db = getD1();
    const lesson = await createLesson(db, id, await readJson(request));
    const { adiSignature: _adi, learnerSignature: _learner, ...summary } = lesson;
    return { lesson: summary, totals: await getTotals(db, id) };
  }, 201);
}
