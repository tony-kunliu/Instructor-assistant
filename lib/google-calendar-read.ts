import { canberraDay, lessonFromGoogle, type CalendarLesson, type GoogleCalendarEvent } from "./today-calendar.ts";

export type CalendarConnection = { clientId: string; clientSecret: string; refreshToken: string; calendarId: string };

export async function readGoogleLessons(connection: CalendarConnection, now: Date, request = fetch) {
  const { date, from, until } = canberraDay(now);
  const token = await request("https://oauth2.googleapis.com/token", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(7000),
    body: new URLSearchParams({
      grant_type: "refresh_token", client_id: connection.clientId,
      client_secret: connection.clientSecret, refresh_token: connection.refreshToken,
    }),
  });
  if (!token.ok) throw new Error("Calendar connection unavailable");
  const auth = await token.json() as { access_token?: string };
  if (!auth.access_token) throw new Error("Calendar connection unavailable");
  const query = new URLSearchParams({
    timeMin: from, timeMax: until, singleEvents: "true", orderBy: "startTime",
    showDeleted: "false", maxResults: "100", timeZone: "Australia/Sydney",
    fields: "nextPageToken,items(id,summary,status,eventType,start,end,description,location,organizer(email),attendees(email,displayName,organizer,self,resource,responseStatus))",
  });
  const lessons = new Map<string, CalendarLesson>();
  let pages = 0;
  let pageToken: string | undefined;
  do {
    if (pageToken) query.set("pageToken", pageToken);
    const response = await request(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendarId)}/events?${query}`, {
      headers: { authorization: `Bearer ${auth.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error("Calendar unavailable");
    const { items, nextPageToken } = await response.json() as { items?: GoogleCalendarEvent[]; nextPageToken?: string };
    for (const item of items ?? []) {
      const lesson = lessonFromGoogle(item);
      if (lesson && Date.parse(lesson.startsAt) >= Date.parse(from) && Date.parse(lesson.startsAt) < Date.parse(until)) lessons.set(lesson.id, lesson);
    }
    pageToken = nextPageToken;
    pages++;
  } while (pageToken && pages < 5);
  return {
    date, lessons: [...lessons.values()].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    incomplete: Boolean(pageToken), refreshedAt: now.toISOString(),
  };
}

type CalendarEnvironment = {
  DB?: unknown;
  GOOGLE_LESSONS_INSTRUCTOR_ID?: string;
  GOOGLE_LESSONS_CALENDAR_ID?: string;
  GOOGLE_LESSONS_CLIENT_ID?: string;
  GOOGLE_LESSONS_CLIENT_SECRET?: string;
  GOOGLE_LESSONS_REFRESH_TOKEN?: string;
};

/** An env.DB binding is required so the existing Access middleware cannot use its local pass-through path. */
export async function workCalendarForInstructor(mode: string, instructor: string | null, env: CalendarEnvironment, now: Date, request = fetch) {
  const { DB, GOOGLE_LESSONS_INSTRUCTOR_ID: owner, GOOGLE_LESSONS_CALENDAR_ID: calendarId,
    GOOGLE_LESSONS_CLIENT_ID: clientId, GOOGLE_LESSONS_CLIENT_SECRET: clientSecret,
    GOOGLE_LESSONS_REFRESH_TOKEN: refreshToken } = env;
  if (mode !== "private" || !DB || !instructor || instructor !== owner || !calendarId || !clientId || !clientSecret || !refreshToken) {
    return { state: "disconnected" as const };
  }
  try {
    return { state: "connected" as const, ...await readGoogleLessons({ calendarId, clientId, clientSecret, refreshToken }, now, request) };
  } catch {
    return { state: "unavailable" as const };
  }
}
