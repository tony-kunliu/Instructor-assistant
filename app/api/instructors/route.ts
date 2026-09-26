import { handle } from "@/lib/api.ts";
import { getDb } from "@/lib/db.ts";
import { listInstructors } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(() => ({ instructors: listInstructors(getDb()) }));
}
