import { handle } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { listLearnerArchiveEvents } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

/** One learner's archive / restore events (newest first), loaded lazily when the archived banner's History is opened. One D1 query. Same middleware/Access gate as every other route. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => ({ events: await listLearnerArchiveEvents(getD1(), id) }));
}
