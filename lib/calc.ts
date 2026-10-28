// Pure CBT&A lesson calculations. Shared by the UI (live preview) and the
// server (authoritative values stored with each lesson).

export const LESSON_TIME_ZONE = "Australia/Sydney"; // Canberra local time
// Project convention: timestamps are STORED as UTC ISO strings and every user-facing date or time is SHOWN in Canberra time
// (this zone, which handles daylight saving). Use canberraDateTime() for display, never `iso.slice(0, 10)`.

/** A stored UTC ISO timestamp as Canberra local `{ date: "YYYY-MM-DD", time: "HH:MM" }`, or null if it does not parse. */
export function canberraDateTime(iso: string | null | undefined): { date: string; time: string } | null {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", { timeZone: LESSON_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(when)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** "HH:MM" (24h) → minutes since midnight, or null if invalid. */
export function parseTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Lesson duration in minutes, or null if times are missing / out of order. */
export function durationMinutes(startTime: string, finishTime: string): number | null {
  const start = parseTime(startTime);
  const finish = parseTime(finishTime);
  if (start === null || finish === null || finish <= start) return null;
  return finish - start;
}

/** Whole-km odometer reading, or null if blank / invalid. */
export function parseOdometer(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const km = Number(text);
  return Number.isSafeInteger(km) ? km : null;
}

/** Lesson distance in km, or null if readings are missing / out of order. */
export function distanceKm(startOdometer: number | null, finishOdometer: number | null): number | null {
  if (startOdometer === null || finishOdometer === null || finishOdometer < startOdometer) return null;
  return finishOdometer - startOdometer;
}

export type Totals = {
  lessonCount: number;
  totalMinutes: number;
  totalKm: number;
  lastFinishOdometer: number | null;
};

export const EMPTY_TOTALS: Totals = { lessonCount: 0, totalMinutes: 0, totalKm: 0, lastFinishOdometer: null };

export function nextLessonNo(totals: Totals): number {
  return totals.lessonCount + 1;
}

/** 90 → "1h 30m", 60 → "1h", 0 → "0h". */
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}m`; // "45m", "0m": no "0h" in front of a short lesson
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** 90 → "1.5" (decimal hours, one place). */
export function decimalHours(total: number): string {
  return (Math.round((total / 60) * 10) / 10).toFixed(1);
}

/** Current date ("YYYY-MM-DD") and time ("HH:MM") in Canberra. */
export function localNow(date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: LESSON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    time: `${pick("hour")}:${pick("minute")}`,
  };
}
