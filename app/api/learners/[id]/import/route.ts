import { handle, readJson } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { importPaperLessons } from "@/lib/repo.ts";
import { requestScope } from "@/lib/scope.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const scope = requestScope(request);
    const body = await readJson(request);
    return importPaperLessons(getD1(), id, typeof body.csv === "string" ? body.csv : "", body.mode as "preview" | "commit", scope);
  });
}
