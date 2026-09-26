import { handle } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { listInstructors } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => ({ instructors: await listInstructors(getD1()) }));
}
