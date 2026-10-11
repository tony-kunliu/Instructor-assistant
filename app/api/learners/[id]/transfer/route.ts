import { handle, postLearnerTransfer } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";

export const dynamic = "force-dynamic";

/** `{ toInstructorId, note? }`: hand the learner over to another active instructor (learner transfer 3c T1). Verified actor only; see lib/api.ts#postLearnerTransfer. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => postLearnerTransfer(getD1(), id, request));
}
