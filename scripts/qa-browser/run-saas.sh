#!/usr/bin/env bash
# Local real-browser QA for the SaaS edition (APP_MODE = "saas"), iPhone 13 / 375 px, plus the product preview
# screenshots.
#
#   bash scripts/qa-browser/run-saas.sh
#   QA_PREVIEW_OUT=/some/dir bash scripts/qa-browser/run-saas.sh   # where the preview PNGs + preview-manifest.json go
#
# Like run.sh it runs entirely on a throw-away COPY of the repo, never the working tree and never a deployed
# environment, with synthetic "QA ..." data only. run.sh (the private-edition pass) is separate and unchanged.
#
# How the copy becomes a SaaS app (only the copy is edited):
#  - Database: under `next start`, next.config.ts's initOpenNextCloudflareForDev() asks wrangler (getPlatformProxy)
#    for the bindings in wrangler.toml, so getCloudflareContext().env.DB is wrangler's LOCAL D1 under
#    .wrangler/state (lib/db.ts getD1() returns env.DB; its node:sqlite fallback with the private schema is never
#    used). The copy's top-level D1 binding gets migrations_dir = "migrations-saas", and
#    `wrangler d1 migrations apply DB --local` builds that brand-new local D1 from migrations-saas/ (0 instructors,
#    no unique-name index). saas.mjs asserts 0 instructors before the first sign-up.
#  - Vars: the copy's top-level [vars] get APP_MODE = "saas" and SAAS_TRIAL_DAYS = "30"; they reach the app through
#    the same getCloudflareContext().env (process.env.APP_MODE / SAAS_TRIAL_DAYS are unset here, so the process.env
#    fallbacks cannot be what makes /api/me report mode "saas"). Note parseTrialDays defaults to 30 as well, so the
#    30-day banner alone cannot tell the var from the default; saas.mjs asserts mode "saas", which comes from the
#    same [vars] table through the same context. Integration V1 is disabled as in run.sh.
#  - Identity: middleware.ts is replaced by a stub that skips modeGate/audienceGate (no Access app locally) and takes
#    the e-mail from the `x-qa-email` request header instead of a verified Cloudflare Access JWT (missing → the
#    production 403 "Cloudflare Access identity required."), then calls the REAL lib/saas/middleware.ts
#    saasMiddleware (saasGate + forwardHeaders). The Access JWT check itself stays a real-login smoke test.
#  - Test setup that has no UI (backdating an account's created_at, setting status = 'inactive', counting
#    instructors) uses `wrangler d1 execute DB --local` against the same local D1 (QA_WORK is passed to saas.mjs).
#
# Output: screenshots go to $QA_PREVIEW_OUT (default $QA_OUT/preview, i.e. inside the throw-away copy, deleted at
# exit — pass QA_PREVIEW_OUT to keep them; never point it inside the repo's tracked tree).
# Needs Playwright (global npm install) with Chromium under $PLAYWRIGHT_BROWSERS_PATH (default /opt/pw-browsers).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${QA_PORT:-3200}"
WORK="$(mktemp -d)"
SERVER_PID=""
cleanup() { [ -n "$SERVER_PID" ] && kill -- "-$SERVER_PID" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT
unset APP_MODE SAAS_TRIAL_DAYS ACTGDS_DRIVER_DB

(cd "$ROOT" && git ls-files -co --exclude-standard | tar -cf - -T -) | tar -xf - -C "$WORK"
cp -a "$ROOT/node_modules" "$WORK/node_modules"
cd "$WORK"
cat > middleware.ts <<'STUB'
import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { saasMiddleware } from "./lib/saas/middleware.ts";
// QA stub (run-saas.sh): identity from x-qa-email instead of a verified Cloudflare Access JWT; the rest is production code.
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { env } = getCloudflareContext();
  const email = request.headers.get("x-qa-email");
  if (!email) return new NextResponse("Cloudflare Access identity required.", { status: 403 });
  return saasMiddleware(request, env, email);
}
export const config = { matcher: "/((?!_next/static|_next/image).*)" };
STUB
sed -i 's/^ACTGDS_INTEGRATION_ENABLED = "true"/ACTGDS_INTEGRATION_ENABLED = "false"/; s#^ACTGDS_WEBHOOK_URL = .*#ACTGDS_WEBHOOK_URL = ""#' wrangler.toml
# First occurrences only = the top-level [vars] and [[d1_databases]] (the [env.production] ones come later in the file).
sed -i '0,/^APP_MODE = .*/s//APP_MODE = "saas"\nSAAS_TRIAL_DAYS = "30"/; 0,/^migrations_dir = .*/s//migrations_dir = "migrations-saas"/' wrangler.toml
grep -q '^APP_MODE = "saas"$' wrangler.toml && grep -q '^SAAS_TRIAL_DAYS = "30"$' wrangler.toml && grep -q '^migrations_dir = "migrations-saas"$' wrangler.toml \
  || { echo "run-saas.sh: could not switch the copy's wrangler.toml to saas"; exit 1; }
npx wrangler d1 migrations apply DB --local >/dev/null
npx next build >build.log 2>&1 || { tail -30 build.log; exit 1; }
setsid npx next start -p "$PORT" >server.log 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do curl -sf -H "x-qa-email: qa-probe@example.test" "http://localhost:$PORT/api/me" >/dev/null && break; sleep 1; done
export QA_BASE="http://localhost:$PORT" QA_OUT="${QA_OUT:-$WORK/shots}" QA_WORK="$WORK" NPM_GLOBAL="$(npm root -g)"
export QA_PREVIEW_OUT="${QA_PREVIEW_OUT:-$QA_OUT/preview}"
mkdir -p "$QA_OUT" "$QA_PREVIEW_OUT"
node "$ROOT/scripts/qa-browser/saas.mjs" || { echo "--- server.log (tail)"; tail -40 server.log; exit 1; }
