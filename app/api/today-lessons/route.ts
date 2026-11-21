import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { currentAppMode } from "@/lib/app-mode.ts";
import { readGoogleLessons } from "@/lib/google-calendar-read.ts";

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
  catch { return process.env as Partial<CloudflareEnv>; }
}

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  const instructor = request.headers.get("x-instructor-id");
  const env = vars();
  // The private app's existing middleware overwrites this with the verified Access instructor.
  // Bind the connection to one instructor, without accepting a calendar or identity from the browser.
  if (currentAppMode() !== "private" || !instructor || instructor !== env.GOOGLE_LESSONS_INSTRUCTOR_ID) {
    return NextResponse.json({ state: "disconnected" }, { headers: noStore });
  }
  const { GOOGLE_LESSONS_CALENDAR_ID: calendarId, GOOGLE_LESSONS_CLIENT_ID: clientId,
    GOOGLE_LESSONS_CLIENT_SECRET: clientSecret, GOOGLE_LESSONS_REFRESH_TOKEN: refreshToken } = env;
  if (!calendarId || !clientId || !clientSecret || !refreshToken) {
    return NextResponse.json({ state: "disconnected" }, { headers: noStore });
  }
  try {
    const result = await readGoogleLessons({ calendarId, clientId, clientSecret, refreshToken }, new Date());
    return NextResponse.json({ state: "connected", ...result }, { headers: noStore });
  } catch {
    return NextResponse.json({ state: "unavailable" }, { status: 503, headers: noStore });
  }
}
