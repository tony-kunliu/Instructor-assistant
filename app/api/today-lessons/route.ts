import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { currentAppMode } from "@/lib/app-mode.ts";
import { workCalendarForInstructor } from "@/lib/google-calendar-read.ts";

export const dynamic = "force-dynamic";

declare global {
  interface CloudflareEnv {
    GOOGLE_LESSONS_INSTRUCTOR_ID?: string;
    GOOGLE_LESSONS_CALENDAR_ID?: string;
    GOOGLE_LESSONS_CLIENT_ID?: string;
    GOOGLE_LESSONS_CLIENT_SECRET?: string;
    GOOGLE_LESSONS_REFRESH_TOKEN?: string;
  }
}

function vars(): Partial<CloudflareEnv> {
  try { return getCloudflareContext().env; }
  catch { return {}; }
}

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  // In the private Worker the existing middleware sets this header after verifying Access.
  const instructor = request.headers.get("x-instructor-id");
  const result = await workCalendarForInstructor(currentAppMode(), instructor, vars(), new Date());
  return NextResponse.json(result, { status: result.state === "unavailable" ? 503 : 200, headers: noStore });
}
