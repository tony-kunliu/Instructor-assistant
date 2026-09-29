import { handle, readJsonWithDefaultInstructor } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { createLearner, listLearners } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const archived = new URL(request.url).searchParams.get("status") === "archived";
  return handle(async () => ({ learners: await listLearners(getD1(), { archived }) }));
}

export async function POST(request: Request) {
  return handle(async () => ({ learner: await createLearner(getD1(), await readJsonWithDefaultInstructor(request)) }), 201);
}
