import { getCloudflareContext } from "@opennextjs/cloudflare";
import { handle } from "@/lib/api.ts";
import { currentAppMode } from "@/lib/app-mode.ts";
import { getD1 } from "@/lib/db.ts";
import { saasMeBody } from "@/lib/saas/accounts.ts";
import { parseTrialDays } from "@/lib/saas/trial.ts";

export const dynamic = "force-dynamic";

/**
 * Who Cloudflare Access says is making this request (Instructor Identity
 * V1, STEP 4) — read from the trusted `x-instructor-id`/`x-instructor-name`
 * headers middleware.ts sets after verifying the Access JWT itself. Never
 * re-derives identity from anything client-submitted. Returns
 * `{ instructor: null }` when there's no Access identity for this request
 * (e.g. local dev, or before Access is in front) — the minimal "Signed in
 * as <name>" UI just doesn't show a name in that case.
 *
 * Also returns the app `mode`. In the SaaS edition the name header is
 * percent-encoded by middleware (lib/saas/gate.ts#forwardHeaders) and is
 * decoded here, and `trialEndsAt` (ISO) is added; `instructor: null` there
 * means "not onboarded yet" (the client sends the person to /welcome).
 */
export async function GET(request: Request) {
  return handle(async () => {
    const mode = currentAppMode();
    if (mode === "saas") return saasMeBody(getD1(), request.headers, parseTrialDays(saasTrialDaysVar()));
    const id = request.headers.get("x-instructor-id");
    const name = request.headers.get("x-instructor-name");
    return { instructor: id && name ? { id, fullName: name } : null, mode };
  });
}

function saasTrialDaysVar(): string | undefined {
  try {
    return getCloudflareContext().env.SAAS_TRIAL_DAYS;
  } catch {
    return process.env.SAAS_TRIAL_DAYS;
  }
}
