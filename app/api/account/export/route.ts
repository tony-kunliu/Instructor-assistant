import { currentAppMode } from "@/lib/app-mode.ts";
import { getD1 } from "@/lib/db.ts";
import { accountExportFilename, buildAccountExport } from "@/lib/saas/account-export.ts";
import { requestScope } from "@/lib/scope.ts";

export const dynamic = "force-dynamic";

/**
 * SaaS edition "Export my data" (spec 2026-10-21-saas-edition-design §8): a JSON file of the signed-in instructor's
 * own learners (active and archived) and their lessons, scoped by the trusted `x-instructor-id` header middleware sets.
 * A GET, so it keeps working after the free trial ends. Not part of the private edition: 404 there.
 */
export async function GET(request: Request) {
  if (currentAppMode() !== "saas") return Response.json({ error: "not_found" }, { status: 404 });
  // Middleware always sets the trusted instructor id here; without it there is no account to export.
  if (!request.headers.get("x-instructor-id")) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const now = new Date();
    const data = await buildAccountExport(getD1(), requestScope(request), now);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${accountExportFilename(now)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
