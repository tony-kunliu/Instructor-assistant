import { NextResponse, type NextRequest } from "next/server";
import { forwardHeaders, saasGate } from "./gate.ts";
import { parseTrialDays } from "./trial.ts";

/**
 * SaaS edition only: every authorization decision is `saasGate`'s; a gate failure (e.g. D1 error) fails closed with 503.
 * Called by middleware.ts once the Cloudflare Access identity is verified; lives here so the qa-browser SaaS pass
 * (scripts/qa-browser/run-saas.sh) runs exactly this code with only the Access JWT check replaced.
 */
export async function saasMiddleware(request: NextRequest, env: CloudflareEnv, email: string): Promise<NextResponse> {
  let result: Awaited<ReturnType<typeof saasGate>>;
  try {
    result = await saasGate(env.DB, { email, method: request.method, pathname: request.nextUrl.pathname, now: new Date(), trialDays: parseTrialDays(env.SAAS_TRIAL_DAYS) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (result.kind === "redirect") return NextResponse.redirect(new URL(result.to, request.url));
  if (result.kind === "error") return NextResponse.json({ error: result.error }, { status: result.status });
  const instructor = result.instructor ?? null;
  return NextResponse.next({ request: { headers: forwardHeaders(request, instructor, instructor ? null : email) } });
}
