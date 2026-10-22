import { handle, readJsonWithActor } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { deletePaperImportDraft, getPaperImportDraft, savePaperImportDraft } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

/** The CSV saved for the paper-records import of this learner (`{ draft: { csv, savedAt } | null }`). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => ({ draft: await getPaperImportDraft(getD1(), id) }));
}

/** `{ csv }`: saves (replaces) the CSV draft. Any text is kept; the import itself still checks it. Only the learner's own instructor when signed in. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJsonWithActor(request);
    return { draft: await savePaperImportDraft(getD1(), id, body.csv, body.actingInstructorId) };
  });
}

/** Removes the CSV draft. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const actor = request.headers.get("x-instructor-id");
    await deletePaperImportDraft(getD1(), id, actor);
    return { ok: true };
  });
}
