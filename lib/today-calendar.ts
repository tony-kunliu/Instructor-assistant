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
const lessonTitle = /\blesson\b/i;
const text = (value: string | undefined, cap = 300) => (value ?? "").trim().slice(0, cap);
const email = (value: string | undefined) => emailPattern.test(text(value)) ? text(value) : null;
const cleanLines = (value: string | undefined) => (value ?? "").slice(0, 16_000)
  .replace(/<(?:br\s*\/?|\/p|\/div|\/li)>/gi, "\n").replace(/<[^>]*>/g, "")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'")
  .split(/\r?\n/).map((line) => line.trim());

function labelledValue(lines: string[], label: RegExp) {
  const i = lines.findIndex((line) => label.test(line));
  return i < 0 ? "" : lines[i].replace(label, "").trim() || (lines[i + 1] ?? "");
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

export function lessonFromGoogle(event: GoogleCalendarEvent): CalendarLesson | null {
  const title = text(event.summary, 260);
  const startsAt = event.start?.dateTime;
  const endsAt = event.end?.dateTime;
  if (!event.id || !title || event.status === "cancelled" || (event.eventType && event.eventType !== "default")
    || !startsAt || !endsAt || !Number.isFinite(Date.parse(startsAt)) || !(Date.parse(endsAt) > Date.parse(startsAt))) return null;
  const isBooking = /https:\/\/(?:[\w-]+\.)?cal\.com\//i.test(event.description ?? "");
  if (!drivingTitle.test(title) && !(isBooking && lessonTitle.test(title))) return null;

  const lines = cleanLines(event.description);
  const guests = (event.attendees ?? []).filter(({ organizer, self, resource, responseStatus, email: value }) =>
    !organizer && !self && !resource && responseStatus !== "declined" && value?.toLowerCase() !== event.organizer?.email?.toLowerCase() && email(value));
  const identified = isBooking ? calGuest(lines) : null;
  const guest = guests.length === 1 ? guests[0] : undefined;
  const titleName = title.match(/\b(?:driving lesson|driving assessment)\s+with\s+([^|]+)$/i)?.[1];
  const name = text(identified?.name ?? guest?.displayName ?? titleName, 120) || null;
  const phone = phoneNumber(labelledValue(lines, /^(?:[\p{L}\s]+\s\/\s)?(?:mobile|phone|phone number|telephone|contact number)\s*:\s*/iu));
  const where = labelledValue(lines, /^(?:where|pick.?up address|meeting address)\s*:\s*/i);
  const address = text(event.location || where, 260);
  return {
    id: event.id, title, startsAt, endsAt, name, phone,
    email: identified?.email ?? email(guest?.email),
    address: address && !/^(?:[a-z]+:\/\/|online$)/i.test(address) ? address : null,
  };
}
