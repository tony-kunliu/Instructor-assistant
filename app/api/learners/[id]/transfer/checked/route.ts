import { handle, postTransferRecordsChecked } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";

export const dynamic = "force-dynamic";

/** The receiving instructor's one-tap "Checked" of the CoP 9.1 h / 9.2 e reminder (design D7). See lib/api.ts#postTransferRecordsChecked. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => postTransferRecordsChecked(getD1(), id, request));
}
