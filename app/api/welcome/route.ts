import { currentAppMode } from "@/lib/app-mode.ts";
import { getD1 } from "@/lib/db.ts";
import { postWelcome } from "@/lib/saas/accounts.ts";

export const dynamic = "force-dynamic";

/**
 * SaaS edition onboarding (spec 2026-10-21-saas-edition-design §4): `POST { fullName, adiNumber }` creates the
 * signed-in person's instructor row (an already onboarded instructor gets 200 with their row, unchanged; see
 * lib/saas/accounts.ts#postWelcome). The e-mail comes only from the `x-access-email` header middleware sets after
 * verifying the Access JWT (never the body). Not part of the private edition: 404 there, so no client-supplied
 * header can ever create an instructor in Tony/Anna's app (private keeps "never auto-create").
 */
export async function POST(request: Request) {
  if (currentAppMode() !== "saas") return Response.json({ error: "not_found" }, { status: 404 });
  return postWelcome(getD1(), request);
}
