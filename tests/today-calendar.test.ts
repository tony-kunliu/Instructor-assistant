import assert from "node:assert/strict";
import test from "node:test";
import { canberraDay, lessonFromGoogle, type GoogleCalendarEvent } from "../lib/today-calendar.ts";
import { readGoogleLessons } from "../lib/google-calendar-read.ts";

const event: GoogleCalendarEvent = {
  id: "lesson",
  summary: "ACTGDS Driving School | Driving Lesson between Example Host and Example Guest",
  start: { dateTime: "2026-11-22T09:30:00+11:00" },
  end: { dateTime: "2026-11-22T10:30:00+11:00" },
  location: "Test pickup, Canberra",
  description: "What:\nDriving Lesson\n\nWho:\nExample Host (Organizer)\nhost@example.test\nExample Guest\nguest@example.test\n\nWhere:\nTest pickup\n\nMobile / Phone:\n0400 000 000\nCancel or change https://cal.com/booking/example",
};

test("passes only useful fields and never treats the organizer or booking link as a customer", () => {
  assert.deepEqual(lessonFromGoogle(event), {
    id: "lesson", title: event.summary, startsAt: event.start!.dateTime, endsAt: event.end!.dateTime,
    name: "Example Guest", phone: "0400000000", email: "guest@example.test", address: "Test pickup, Canberra",
  });
});

test("missing or ambiguous contacts stay empty, and calendar noise is excluded", () => {
  const result = lessonFromGoogle({
    ...event, summary: "Driving lesson with Alex", description: "", location: "https://example.test/meet",
    attendees: [{ email: "one@example.test" }, { email: "two@example.test" }],
  });
  assert.equal(result?.name, "Alex");
  assert.equal(result?.email, null);
  assert.equal(result?.phone, null);
  assert.equal(result?.address, null);
  assert.equal(lessonFromGoogle({ ...event, summary: "Family dinner", description: "" }), null);
  assert.equal(lessonFromGoogle({ ...event, status: "cancelled" }), null);
  assert.equal(lessonFromGoogle({ ...event, start: {} }), null);
});

test("day bounds handle Canberra daylight-saving without using the server's timezone", () => {
  assert.deepEqual(canberraDay(new Date("2026-11-21T15:00:00Z")), {
    date: "2026-11-22", from: "2026-11-21T13:00:00.000Z", until: "2026-11-22T13:00:00.000Z",
  });
  const spring = canberraDay(new Date("2026-10-04T02:00:00Z"));
  assert.equal((Date.parse(spring.until) - Date.parse(spring.from)) / 3_600_000, 23);
});

test("read-only calendar adapter expands recurring events, handles pages, and removes yesterday's overlapping event", async () => {
  const calls: { url: string; method: string; cached?: string }[] = [];
  const mocked: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", cached: init?.cache });
    if (calls.length === 1) return Response.json({ access_token: "test-token" });
    if (calls.length === 2) return Response.json({ items: [event], nextPageToken: "next" });
    return Response.json({ items: [event, { ...event, id: "yesterday", start: { dateTime: "2026-11-21T23:30:00+11:00" },
      end: { dateTime: "2026-11-22T00:30:00+11:00" } }] });
  };
  const result = await readGoogleLessons({ clientId: "id", clientSecret: "secret", refreshToken: "refresh", calendarId: "test@example.test" },
    new Date("2026-11-21T15:00:00Z"), mocked);
  assert.equal(result.lessons.length, 1);
  assert.equal(result.incomplete, false);
  assert.deepEqual(calls.map(({ method, cached }) => [method, cached]), [["POST", "no-store"], ["GET", "no-store"], ["GET", "no-store"]]);
  assert.equal(new URL(calls[1].url).searchParams.get("singleEvents"), "true");
  assert.equal(new URL(calls[2].url).searchParams.get("pageToken"), "next");
  assert.doesNotMatch(JSON.stringify(result), /test-token|secret|refresh-token|cal\.com/i);
});
