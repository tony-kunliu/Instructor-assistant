import { handle, readJsonWithActor } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { signLesson } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

/** `{ adiSignature, learnerSignature, expectedUpdatedAt }`: signs an app lesson saved to sign later; its content never changes here. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const { id, lessonId } = await params;
  return handle(async () => {
    const { adiSignature: _adi, learnerSignature: _learner, ...lesson } = await signLesson(getD1(), id, lessonId, await readJsonWithActor(request));
    return { lesson };
  });
}
