import { handle, patchInstructor } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";

export const dynamic = "force-dynamic";

/** `{ adiNumber }`: only the signed-in instructor may change their own ADI number (see lib/api.ts#patchInstructor). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => patchInstructor(getD1(), id, request));
}
