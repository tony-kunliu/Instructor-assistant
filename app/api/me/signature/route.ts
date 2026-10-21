import { handle, readJson } from "@/lib/api.ts";
import { getD1 } from "@/lib/db.ts";
import { getOwnAdiSignature, setOwnAdiSignature, ValidationError } from "@/lib/repo.ts";

export const dynamic = "force-dynamic";

/** The trusted `x-instructor-id` (set by middleware after verifying the Access JWT); never anything client-submitted. */
function signedInInstructorId(request: Request): string {
  const id = request.headers.get("x-instructor-id");
  if (!id) throw new ValidationError("Sign in first: your saved signature is kept per instructor.");
  return id;
}

/** `{ signature }`: the signed-in instructor's own saved ADI signature (PNG data URL) or null. */
export async function GET(request: Request) {
  return handle(async () => ({ signature: await getOwnAdiSignature(getD1(), signedInInstructorId(request)) }));
}

/** `{ signature }`: save the signed-in instructor's own ADI signature; an empty value removes it. */
export async function PUT(request: Request) {
  return handle(async () => {
    const id = signedInInstructorId(request);
    const body = await readJson(request);
    if (typeof body.signature !== "string") throw new ValidationError("signature must be a PNG data URL, or an empty string to remove it.");
    return { signature: await setOwnAdiSignature(getD1(), id, body.signature) };
  });
}
