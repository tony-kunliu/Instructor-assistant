import { handle, readJsonWithDefaultInstructor } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { createLearner, listLearners, listLearnerSummaries } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

// Two statements: the learners and their card summaries (one set-based aggregate, see lib/repo.ts#listLearnerSummaries).
// `summaries=0` skips the aggregate (one statement): the client's background archived fetch for the duplicate-licence
// check needs only the learners; the Archived tab fetches the summaries when it is opened.
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const archived = params.get("status") === "archived";
  const withSummaries = params.get("summaries") !== "0";
  return handle(async () => {
    const db = getD1();
    const [learners, summaries] = await Promise.all([listLearners(db, { archived }), withSummaries ? listLearnerSummaries(db, { archived }) : Promise.resolve({})]);
    return { learners, summaries };
  });
}

export async function POST(request: Request) {
  return handle(async () => ({ learner: await createLearner(getD1(), await readJsonWithDefaultInstructor(request)) }), 201);
}
