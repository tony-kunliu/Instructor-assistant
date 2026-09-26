import { handle, readJson } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { updateInstructorAdiNumber } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    return { instructor: await updateInstructorAdiNumber(getD1(), id, body.adiNumber) };
  });
}
