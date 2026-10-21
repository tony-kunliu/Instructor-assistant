import { handle } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { listActiveInstructors } from "@/lib/repo.ts";
import { requestScope } from "@/lib/scope.ts";

export const dynamic = "force-dynamic";

/** Active instructors only — the only ones a new learner may be assigned to (see lib/repo.ts#createLearner). */
export function GET(request: Request) {
  return handle(async () => ({ instructors: await listActiveInstructors(getD1(), requestScope(request)) }));
}
