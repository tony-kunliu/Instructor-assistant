import { handle } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { listUnsignedLessons } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

/** The To sign queue: app lessons saved to sign later, for active learners, oldest first; only the signed-in instructor's own lessons. */
export async function GET(request: Request) {
  return handle(async () => ({ lessons: await listUnsignedLessons(getD1(), request.headers.get("x-instructor-id")) }));
}
