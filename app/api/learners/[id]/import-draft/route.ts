import { handle, readJsonWithActor } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { deletePaperImportDraft, getPaperImportDraft, savePaperImportDraft } from "@/lib/repo.ts";
import { requestScope } from "@/lib/scope.ts";

export const dynamic = "force-dynamic";

// The CSV is the learner's records typed up: every method applies the request scope (SaaS: only the instructor's own learners).

/** The CSV saved for the paper-records import of this learner (`{ draft: { csv, savedAt } | null }`). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => ({ draft: await getPaperImportDraft(getD1(), id, requestScope(request)) }));
}

/** `{ csv }`: saves (replaces) the CSV draft. Any text is kept; the import itself still checks it. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const scope = requestScope(request);
    const body = await readJsonWithActor(request);
    return { draft: await savePaperImportDraft(getD1(), id, body.csv, body.actingInstructorId, scope) };
  });
}

/** Removes the CSV draft. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    await deletePaperImportDraft(getD1(), id, requestScope(request));
    return { ok: true };
  });
}
