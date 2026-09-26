import { handle, readJson } from "@/lib/api.ts";
import { getDb } from "@/lib/db.ts";
import { createLearner, listLearners } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(() => ({ learners: listLearners(getDb()) }));
}

export async function POST(request: Request) {
  return handle(async () => ({ learner: createLearner(getDb(), await readJson(request)) }), 201);
}
