#!/usr/bin/env bash
# Focused real-browser QA for the Today’s lessons panel.
# Runs on a disposable copy with local D1, Integration V1 disabled and synthetic learners only.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${QA_PORT:-3100}"
WORK="$(mktemp -d)"
SERVER_PID=""
cleanup() { [ -n "$SERVER_PID" ] && kill -- "-$SERVER_PID" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

(cd "$ROOT" && git ls-files -co --exclude-standard | tar -cf - -T -) | tar -xf - -C "$WORK"
cp -a "$ROOT/node_modules" "$WORK/node_modules"
cd "$WORK"
cat > middleware.ts <<'STUB'
import { NextResponse } from "next/server";
export function middleware() { return NextResponse.next(); }
export const config = { matcher: "/((?!_next/static|_next/image).*)" };
STUB
# The readiness route exists only in the disposable copy; it proves local D1 is bound before QA starts.
mkdir -p app/api/qa-ready
cat > app/api/qa-ready/route.ts <<'READY'
import { getCloudflareContext } from "@opennextjs/cloudflare";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    if (getCloudflareContext().env.DB) return new Response(null, { status: 204 });
  } catch {
    // The local Cloudflare context has not been initialized yet.
  }
  return new Response(null, { status: 503 });
}
READY
sed -i 's/^ACTGDS_INTEGRATION_ENABLED = "true"/ACTGDS_INTEGRATION_ENABLED = "false"/; s#^ACTGDS_WEBHOOK_URL = .*#ACTGDS_WEBHOOK_URL = ""#' wrangler.toml
npx wrangler d1 migrations apply DB --local >/dev/null
npx next build >build.log 2>&1 || { tail -30 build.log; exit 1; }
setsid npx next start -p "$PORT" >server.log 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 40); do
  curl -sf "http://localhost:$PORT/api/qa-ready" >/dev/null && break
  sleep 1
done
if ! curl -sf "http://localhost:$PORT/api/qa-ready" >/dev/null; then
  tail -30 server.log
  echo "Local D1 did not become ready" >&2
  exit 1
fi
export QA_BASE="http://localhost:$PORT" QA_OUT="${QA_OUT:-$WORK/shots}" NPM_GLOBAL="${NPM_GLOBAL:-$(npm root -g)}"
mkdir -p "$QA_OUT"
node "$ROOT/scripts/qa-browser/today-lessons.mjs"
