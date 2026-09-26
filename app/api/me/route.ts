import { handle } from "@/lib/api.ts";

export const dynamic = "force-dynamic";

/**
 * Who Cloudflare Access says is making this request (Instructor Identity
 * V1, STEP 4) — read from the trusted `x-instructor-id`/`x-instructor-name`
 * headers middleware.ts sets after verifying the Access JWT itself. Never
 * re-derives identity from anything client-submitted. Returns
 * `{ instructor: null }` when there's no Access identity for this request
 * (e.g. local dev, or before Access is in front) — the minimal "Signed in
 * as <name>" UI just doesn't show a name in that case.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const id = request.headers.get("x-instructor-id");
    const name = request.headers.get("x-instructor-name");
    return { instructor: id && name ? { id, fullName: name } : null };
  });
}
