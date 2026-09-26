import { handle, readJson } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { createLearner, listLearners } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => ({ learners: await listLearners(getD1()) }));
}

export async function POST(request: Request) {
  return handle(async () => ({ learner: await createLearner(getD1(), await readJson(request)) }), 201);
}
