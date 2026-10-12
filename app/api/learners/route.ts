import { handle, readJsonWithDefaultInstructor } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { createLearner, listLearners, listLearnerSummaries } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

// Two statements: the learners and their card summaries (one set-based aggregate, see lib/repo.ts#listLearnerSummaries).
export function GET(request: Request) {
  const archived = new URL(request.url).searchParams.get("status") === "archived";
  return handle(async () => {
    const db = getD1();
    const [learners, summaries] = await Promise.all([listLearners(db, { archived }), listLearnerSummaries(db, { archived })]);
    return { learners, summaries };
  });
}

export async function POST(request: Request) {
  return handle(async () => ({ learner: await createLearner(getD1(), await readJsonWithDefaultInstructor(request)) }), 201);
}
