#!/usr/bin/env bash
# Local real-browser QA for the instructor app (iPhone 13 width, 390px).
#
#   bash scripts/qa-browser/run.sh
#
# Runs entirely on a throw-away COPY of the repo, never the working tree and
# never a deployed environment: local D1 (wrangler --local), Integration V1
# disabled, synthetic "QA ..." learners only. In the copy only, middleware.ts
# is replaced by a stub that trusts x-instructor-* request headers so the
# browser can act as Tony or Anna — the real Cloudflare Access check is NOT
# exercised here (that stays a minimal real-login smoke test on Staging).
# Needs Playwright (global npm install) with Chromium under
# $PLAYWRIGHT_BROWSERS_PATH (default /opt/pw-browsers).
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
sed -i 's/^ACTGDS_INTEGRATION_ENABLED = "true"/ACTGDS_INTEGRATION_ENABLED = "false"/; s#^ACTGDS_WEBHOOK_URL = .*#ACTGDS_WEBHOOK_URL = ""#' wrangler.toml
npx wrangler d1 migrations apply DB --local >/dev/null
npx next build >build.log 2>&1 || { tail -30 build.log; exit 1; }
setsid npx next start -p "$PORT" >server.log 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 40); do curl -sf "http://localhost:$PORT/api/instructors" >/dev/null && break; sleep 1; done
export QA_BASE="http://localhost:$PORT" QA_OUT="${QA_OUT:-$WORK/shots}" NPM_GLOBAL="$(npm root -g)"
mkdir -p "$QA_OUT"
node "$ROOT/scripts/qa-browser/seed.mjs"
node "$ROOT/scripts/qa-browser/qa.mjs"
# Isolated P4 GPS recorder page (/gps): synthetic drive only, geolocation spied, 375/820 px, light + dark.
node "$ROOT/scripts/qa-browser/gps.mjs"
