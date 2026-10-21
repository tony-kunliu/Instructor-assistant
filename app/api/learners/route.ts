import { handle, parseLearnerListQuery, readJsonForNewLearner } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { createLearner, listLearners, listLearnerSummaries } from "@/lib/repo.ts";
import { requestScope } from "@/lib/scope.ts";

export const dynamic = "force-dynamic";

// Two statements: the learners and their card summaries (one set-based aggregate, see lib/repo.ts#listLearnerSummaries).
// `summaries=0` skips the aggregate (one statement): the client's background archived fetch for the duplicate-licence
// check needs only the learners; the Archived tab fetches the summaries when it is opened.
export function GET(request: Request) {
  const { archived, withSummaries } = parseLearnerListQuery(request.url);
  return handle(async () => {
    const scope = requestScope(request);
    const db = getD1();
    const [learners, summaries] = await Promise.all([listLearners(db, { archived, scope }), withSummaries ? listLearnerSummaries(db, { archived, scope }) : Promise.resolve({})]);
    return { learners, summaries };
  });
}

export async function POST(request: Request) {
  return handle(async () => ({ learner: await createLearner(getD1(), await readJsonForNewLearner(request, requestScope(request))) }), 201);
}
