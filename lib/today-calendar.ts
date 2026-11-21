import { localNow } from "./calc.ts";
import { canberraInstant } from "./rules.ts";

export type CalendarLesson = {
  id: string;
  title: string;
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  startsAt: string;
  endsAt: string;
};

export type GoogleCalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  eventType?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  organizer?: { email?: string };
  attendees?: { email?: string; displayName?: string; organizer?: boolean; self?: boolean; resource?: boolean; responseStatus?: string }[];
};

export function canberraDay(now: Date) {
  const date = localNow(now).date;
  return {
    date,
    from: new Date(canberraInstant(date, 0, "earlier")!).toISOString(),
    until: new Date(canberraInstant(date, 1440, "later")!).toISOString(),
  };
}

const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const drivingTitle = /\b(?:driving (?:lesson|assessment|test)|driv(?:er|ing) training|cbt\s*&\s*a)\b|学车|駕駛課|驾驶课|练车/i;
const nonLessonTitle = /\b(?:no|not\s+(?:a|an|the))\s+(?:driving (?:lesson|assessment|test)|driv(?:er|ing) training|cbt\s*&\s*a)\b|(?:取消|不)\s*(?:学车|駕駛課|驾驶课|练车)/i;
const phoneLabel = /^(?:[\p{L}\s]+\s\/\s)?(?:mobile|phone|phone number|telephone|contact number)\s*:\s*/iu;
const pickupLabel = /^(?:pick.?up address|meeting address)\s*:\s*/i;
const text = (value: string | undefined, cap = 300) => (value ?? "").trim().slice(0, cap);
const email = (value: string | undefined) => emailPattern.test(text(value)) ? text(value) : null;
const cleanLines = (value: string | undefined) => (value ?? "").slice(0, 16_000)
  .replace(/<(?:br\s*\/?|\/p|\/div|\/li)>/gi, "\n").replace(/<[^>]*>/g, "")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'")
  .split(/\r?\n/).map((line) => line.trim());

function labelledValues(lines: string[], label: RegExp) {
  return lines.flatMap((line, i) => label.test(line)
    ? [line.replace(label, "").trim() || (lines[i + 1] ?? "")] : []);
}

function calGuest(lines: string[]) {
  const start = lines.findIndex((line) => /^Who:?$/i.test(line));
  if (start < 0) return null;
  const guests: { name: string; email: string }[] = [];
  for (let i = start + 1; i < lines.length && i <= start + 20; i++) {
    if (/^(?:where|what|when|description|invitee time.?zone|additional (?:notes|information))\s*:/i.test(lines[i])) break;
    const address = email(lines[i]);
    const name = text(lines[i - 1], 120);
    if (address && name && !/\b(?:organizer|organiser|host)\b|[@:]/i.test(name)) guests.push({ name, email: address });
  }
  return guests.length === 1 ? guests[0] : null;
}

function phoneNumber(value: string): string | null {
  const raw = value.replace(/[\s().-]/g, "");
  return /^(?:0\d{9}|\+61\d{9})$/.test(raw) ? raw : null;
}

function pickupAddress(value: string | undefined): string | null {
  const address = text(value, 260);
  return address && !/^(?:[a-z]+:\/\/|www\.|online$)/i.test(address) ? address : null;
}

export function lessonFromGoogle(event: GoogleCalendarEvent): CalendarLesson | null {
  const title = text(event.summary, 260);
  const startsAt = event.start?.dateTime;
  const endsAt = event.end?.dateTime;
  if (!event.id || !title || event.status === "cancelled" || (event.eventType && event.eventType !== "default")
    || !startsAt || !endsAt || !Number.isFinite(Date.parse(startsAt)) || !(Date.parse(endsAt) > Date.parse(startsAt))) return null;
  const isBooking = /https:\/\/(?:[\w-]+\.)?cal\.com\//i.test(event.description ?? "");
  if (!drivingTitle.test(title) || nonLessonTitle.test(title)) return null;

  const lines = cleanLines(event.description);
  const guests = (event.attendees ?? []).filter(({ organizer, self, resource, responseStatus, email: value }) =>
    !organizer && !self && !resource && responseStatus !== "declined" && value?.toLowerCase() !== event.organizer?.email?.toLowerCase() && email(value));
  const identified = isBooking ? calGuest(lines) : null;
  const guest = guests.length === 1 ? guests[0] : undefined;
  const titleName = title.match(/\b(?:driving lesson|driving assessment)\s+with\s+([^|]+)$/i)?.[1];
  const name = text(identified?.name ?? guest?.displayName ?? titleName, 120) || null;
  const phoneValues = labelledValues(lines, phoneLabel).map(phoneNumber);
  const phone = phoneValues.every((value) => value && value.replace(/^\+61/, "0") === phoneValues[0]?.replace(/^\+61/, "0"))
    ? phoneValues[0] ?? null : null;
  const pickup = [...new Set(labelledValues(lines, pickupLabel).map(pickupAddress).filter(Boolean))];
  const address = pickup.length > 1 ? null : pickup[0] ?? pickupAddress(event.location)
    ?? pickupAddress(labelledValues(lines, /^where\s*:\s*/i)[0]);
  return {
    id: event.id, title, startsAt, endsAt, name, phone,
    email: identified?.email ?? email(guest?.email),
    address,
  };
}

/** For overlapping bookings, the latest actual end determines when the next transition can start. */
export function previousLessonFor(lessons: readonly CalendarLesson[], index: number) {
  return lessons.slice(0, index).reduce<CalendarLesson | undefined>((latest, candidate) =>
    !latest || Date.parse(candidate.endsAt) > Date.parse(latest.endsAt) ? candidate : latest, undefined);
}
