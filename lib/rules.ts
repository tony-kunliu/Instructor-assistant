// Assessment-rules REMINDERS (T1 of docs/superpowers/specs/2026-10-10-rules-reminders-and-learner-phase2-design.md).
//
// Display only (D1): nothing here blocks, changes or rejects a save, a History
// Edit or an API call. Pure functions, no clock inside (`now` is always passed
// in), no database, no network (D4). Rule text is from the ACT instruments
// NI2020-703 (Assessment Standards 2020) and DI2020-294 (Code of Practice 2020);
// the instruments win over this file (docs/ACT_ASSESSMENT_STANDARDS.md).
//
// Tones: "amber" = not yet / outside the rule, "grey" = data missing so the rule
// cannot be checked (never a false pass), "plain" = rule met per the entered data.

import { LESSON_TIME_ZONE, localNow, parseTime } from "./calc.ts";
import { lookupActHoliday } from "./act-public-holidays.ts";
import { CORE_COMPETENCY_IDS, REVIEW_1_17, REVIEW_1_22, type LearnerProgress } from "./competency.ts";

export type ReminderTone = "amber" | "grey" | "plain";
export type Reminder = { id: string; tone: ReminderTone; text: string };

/** CoP 9.2 n: ADI Audit booking is an online form; the app only links to it and stores nothing about bookings (D3). */
export const ADI_AUDIT_BOOKING_URL = "https://forms.act.gov.au/smartforms/servlet/SmartForm.html?formCode=1503";
export const ADI_AUDIT_BOOKING_LINK_TEXT = "Book the Competency 23 drive with ADI Audit (ACT online form)";
export const ADI_AUDIT_BOOKING_NOTE = "Book at least 1 clear business day before, in writing (CoP 9.2 n).";

/** NI2020-703, Review 1 and Review 2: "not less than 36 hours". */
export const REVIEW_GAP_HOURS = 36;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ───────────────────────── Canberra time (D6) ─────────────────────────

const wallFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: LESSON_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** The Canberra wall clock at an instant, expressed as a UTC-based millisecond count. */
function wallOf(instantMs: number): number {
  const parts = wallFormat.formatToParts(new Date(Math.floor(instantMs / 1000) * 1000));
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"), pick("second"));
}

const offsetAt = (instantMs: number) => wallOf(instantMs) - Math.floor(instantMs / 1000) * 1000;

function parseIsoDate(date: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

/**
 * The instant for a Canberra wall time (`minutes` after midnight of `date`; 1440 = 24:00).
 * Real elapsed time across daylight saving: the repeated hour in April has two readings and
 * `prefer` picks one ("earlier"/"later" instant); a time skipped in October (which does not exist) is read
 * both ways, one hour apart, and `prefer` picks one. Returns null for an invalid date.
 */
export function canberraInstant(date: string, minutes: number, prefer: "earlier" | "later"): number | null {
  const parsed = parseIsoDate(date);
  if (!parsed) return null;
  const wall = Date.UTC(parsed.y, parsed.m - 1, parsed.d) + minutes * 60_000;
  const offsets = new Set([offsetAt(wall - DAY_MS), offsetAt(wall + DAY_MS)]);
  const candidates = [...offsets].map((offset) => wall - offset).filter((instant) => wallOf(instant) === wall);
  // A wall time skipped at the October change does not exist: read it with either offset
  // (the two readings are an hour apart) and let `prefer` take the less favourable one.
  if (candidates.length === 0) candidates.push(wall - offsetAt(wall - DAY_MS), wall - offsetAt(wall + DAY_MS));
  return prefer === "earlier" ? Math.min(...candidates) : Math.max(...candidates);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const pad = (n: number) => String(n).padStart(2, "0");

/** "Thu 8 Oct, 03:40" in Canberra time. */
export function formatCanberraMoment(instantMs: number): string {
  const wall = new Date(wallOf(instantMs));
  return `${WEEKDAYS[wall.getUTCDay()]} ${wall.getUTCDate()} ${MONTHS[wall.getUTCMonth()]}, ${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
}

/** "3 Oct 2026". */
export function formatDate(date: string): string {
  const parsed = parseIsoDate(date);
  return parsed ? `${parsed.d} ${MONTHS[parsed.m - 1]} ${parsed.y}` : date;
}

/** 0 = Sunday … 6 = Saturday, for a calendar date (no time zone involved). */
function weekdayOf(date: string): number | null {
  const parsed = parseIsoDate(date);
  return parsed ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).getUTCDay() : null;
}

function daysBetween(fromDate: string, toDate: string): number | null {
  const from = parseIsoDate(fromDate);
  const to = parseIsoDate(toDate);
  if (!from || !to) return null;
  return Math.round((Date.UTC(to.y, to.m - 1, to.d) - Date.UTC(from.y, from.m - 1, from.d)) / DAY_MS);
}

// ───────────────────────── R1: 36 hours before a review ─────────────────────────

/** The lesson fields R1 needs. `Lesson` (lib/types.ts) satisfies this. */
export type LessonForRules = { id: string; lessonNo: number; lessonDate: string; finishTime: string | null };

/** When the review would start: right now (Start Lesson panel) or the draft's date + start time (lesson form, D9). */
export type ReviewMoment = { kind: "now"; now: Date } | { kind: "draft"; date: string; startTime: string };

const reviewLabel = (review: string) => (review === REVIEW_1_17 ? "Review 1-17" : "Review 1-22");
const lessonLabel = (lessonNo: number) => (lessonNo > 0 ? `Lesson #${lessonNo}` : "the prior-instructor record");

/**
 * R1 (NI2020-703): Review 1 not less than 36 hours after competencies 1 to 17 are
 * completed; Review 2 not less than 36 hours after 1 to 22 are completed.
 * "Completed" = the latest, over the set, of each competency's earliest Assessed + Achieved
 * lesson, taken at that lesson's finish time (D7); no finish time = the end of that day (D8).
 * Never uses competency_events.created_at. Returns null when the review is not "ready"
 * (locked or already achieved: nothing to remind).
 */
export function reviewGapReminder(args: {
  review: typeof REVIEW_1_17 | typeof REVIEW_1_22;
  progress: LearnerProgress;
  lessons: readonly LessonForRules[];
  moment: ReviewMoment;
  /** "panel" = Start Lesson panel wording, "form" = lesson-form wording. */
  where: "panel" | "form";
}): Reminder | null {
  const { review, progress, lessons, moment, where } = args;
  const state = review === REVIEW_1_17 ? progress.review1_17 : progress.review1_22;
  if (state.status !== "ready") return null;
  const id = `r1-${review}`;
  const label = reviewLabel(review);
  const setName = review === REVIEW_1_17 ? "1-17" : "1-22";
  const setIds = CORE_COMPETENCY_IDS.slice(0, review === REVIEW_1_17 ? 17 : 22);
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));

  const completedAt = (lesson: LessonForRules): number | null => {
    const finish = lesson.finishTime ? parseTime(lesson.finishTime) : null;
    return canberraInstant(lesson.lessonDate, finish ?? 1440, "later");
  };

  let completing: { lesson: LessonForRules; at: number } | null = null;
  for (const competencyId of setIds) {
    let earliest: { lesson: LessonForRules; at: number } | null = null;
    for (const lessonId of progress.competencies[competencyId]?.achievedLessonIds ?? []) {
      const lesson = byId.get(lessonId);
      const at = lesson ? completedAt(lesson) : null;
      if (!lesson || at === null) continue;
      if (!earliest || at < earliest.at || (at === earliest.at && lesson.lessonNo < earliest.lesson.lessonNo)) earliest = { lesson, at };
    }
    if (!earliest) return { id, tone: "grey", text: `Cannot check the 36 h rule for ${label}: the lesson where Competency ${competencyId} was achieved is not in the history.` };
    if (!completing || earliest.at > completing.at || (earliest.at === completing.at && earliest.lesson.lessonNo > completing.lesson.lessonNo)) completing = earliest;
  }
  if (!completing) return null;

  let reviewAt: number | null;
  if (moment.kind === "now") {
    reviewAt = moment.now.getTime();
  } else {
    const start = parseTime(moment.startTime);
    reviewAt = start === null ? null : canberraInstant(moment.date, start, "earlier");
  }
  if (reviewAt === null) return { id, tone: "grey", text: `Add the lesson date and start time to check the 36 h rule for ${label}.` };

  const { lesson } = completing;
  const noFinish = lesson.finishTime === null || parseTime(lesson.finishTime) === null;
  const note = noFinish ? ` ${lessonLabel(lesson.lessonNo)} has no finish time; counted from the end of that day.` : "";
  const allowedFrom = completing.at + REVIEW_GAP_HOURS * HOUR_MS;
  if (reviewAt >= allowedFrom) {
    const when = noFinish ? `end of ${formatCanberraMoment(completing.at - 1).split(",")[0]}` : formatCanberraMoment(completing.at);
    return { id, tone: "plain", text: `${label}: 36 h rule met (${setName} completed in ${lessonLabel(lesson.lessonNo)}, ${when}).${note}` };
  }
  const allowed = formatCanberraMoment(allowedFrom);
  const text =
    where === "panel"
      ? `${label} allowed from ${allowed} (36 h after ${lessonLabel(lesson.lessonNo)}).${note}`
      : `This ${label} starts within 36 h of ${lessonLabel(lesson.lessonNo)} (allowed from ${allowed}). You can still save.${note}`;
  return { id, tone: "amber", text };
}

// ───────────────────────── R3: Competency 23 hours and days ─────────────────────────

const WINDOW_START = 7 * 60;

/** Latest finish: 21:00 on a Friday, 19:00 Mon-Thu and Saturday. Sunday has no window. */
function windowEnd(weekday: number): number | null {
  if (weekday === 0) return null;
  return weekday === 5 ? 21 * 60 : 19 * 60;
}
const windowText = (weekday: number) => `07:00–${weekday === 5 ? "21:00" : "19:00"}`;

/** Sunday / holiday / holiday-table-range problem for a date, or null when the day itself is fine. */
function dayProblem(date: string): Reminder | null {
  const weekday = weekdayOf(date);
  if (weekday === 0) return { id: "r3-day", tone: "amber", text: "Competency 23 is not allowed on Sundays." };
  const holiday = lookupActHoliday(date);
  if (holiday.kind === "holiday") return { id: "r3-day", tone: "amber", text: `Competency 23 is not allowed on ACT public holidays (${holiday.name}).` };
  if (holiday.kind === "not_loaded") return { id: "r3-holidays", tone: "grey", text: `ACT public holidays for ${holiday.year} are not loaded; check manually.` };
  return null;
}

/** Start Lesson panel, 23 Final Drive ready: one line about today (Canberra date). */
export function finalDrivePanelReminder(now: Date): Reminder {
  const today = localNow(now).date;
  const weekday = weekdayOf(today) ?? 0;
  const problem = dayProblem(today);
  if (problem && problem.tone === "amber") return problem;
  const hours = `Competency 23 hours today (${WEEKDAYS[weekday]}): ${windowText(weekday)}`;
  if (problem) return { id: "r3", tone: "grey", text: `${hours}. ${problem.text}` };
  // "plain" means the rule is met per the data: only while the Canberra clock is inside today's window
  // (07:00 up to, not including, the closing time: a drive can no longer be completed at 19:00 sharp).
  const nowMinutes = parseTime(localNow(now).time) ?? 0;
  if (nowMinutes < WINDOW_START || nowMinutes >= (windowEnd(weekday) ?? 0)) return { id: "r3", tone: "amber", text: `${hours}; it is currently outside the window.` };
  return { id: "r3", tone: "plain", text: `${hours}.` };
}

/** Lesson form, 23 Final Drive ticked as Assessed: checks the draft's date, start and finish time (Q7: both inside the window). */
export function finalDriveFormReminders(draft: { date: string; startTime: string; finishTime: string }): Reminder[] {
  const weekday = weekdayOf(draft.date);
  if (weekday === null) return [{ id: "r3", tone: "grey", text: "Add the lesson date to check the Competency 23 rules." }];
  const out: Reminder[] = [];
  const problem = dayProblem(draft.date);
  if (problem) out.push(problem);
  if (problem?.tone === "amber") return out; // Sunday or holiday: the hours are moot.
  const start = parseTime(draft.startTime);
  const finish = parseTime(draft.finishTime);
  const end = windowEnd(weekday) ?? 0;
  const lessonText = `${start === null ? "…" : draft.startTime}–${finish === null ? "…" : draft.finishTime}`;
  // Anything already known to be outside the window is amber, even with the other time still missing.
  const outside = (start !== null && (start < WINDOW_START || start >= end)) || (finish !== null && finish > end) || (start !== null && finish !== null && finish < start);
  if (outside) out.push({ id: "r3", tone: "amber", text: `Competency 23 must run 07:00–19:00 Mon–Thu/Sat (Fri to 21:00). This lesson: ${lessonText}.` });
  if (start === null || finish === null) {
    out.push({ id: "r3-add", tone: "grey", text: "Add start and finish time to check the Competency 23 hours." });
  } else if (!outside) {
    // With the holiday table not loaded the day is unchecked, so a fitting time is never shown as a pass (grey).
    out.push({ id: "r3", tone: problem ? "grey" : "plain", text: `Competency 23 hours met (${WEEKDAYS[weekday]}): this lesson ${lessonText} is inside ${windowText(weekday)}.` });
  }
  return out;
}

// ───────────────────────── R5: learner licence current ─────────────────────────

/**
 * R5 (NI2020-703 note; CoP 9 a, c): the student must hold a current ACT learner licence.
 * Current = expiry on or after `onDate` (the expiry day counts, D14); amber within 30 days.
 * Only for the learner stage; other stages return null.
 */
export function learnerLicenceReminder(learner: { licenceStage: string; licenceExpiry: string | null }, onDate: string): Reminder | null {
  if (learner.licenceStage !== "learner") return null;
  const id = "r5";
  if (!learner.licenceExpiry) return { id, tone: "grey", text: "Add licence expiry to check the learner licence is current." };
  const days = daysBetween(onDate, learner.licenceExpiry);
  if (days === null) return { id, tone: "grey", text: "Check the licence expiry date: it is not a valid date, so the learner licence cannot be checked." };
  const expiry = formatDate(learner.licenceExpiry);
  if (days < 0) return { id, tone: "amber", text: `Learner licence expired ${expiry}: check a current ACT learner licence before training.` };
  if (days === 0) return { id, tone: "amber", text: `Learner licence expires today (${expiry}).` };
  if (days <= 30) return { id, tone: "amber", text: `Learner licence expires ${expiry} (${days} ${days === 1 ? "day" : "days"}).` };
  return { id, tone: "plain", text: `Learner licence current: expires ${expiry}.` };
}

// ───────────────────────── R2: Competency 23 eligibility ─────────────────────────

/** The learner fields R2 needs (all optional data; `Learner` from lib/types.ts satisfies this). */
export type EligibilityLearner = {
  dob: string | null;
  licenceExpiry: string | null;
  learnerLicenceIssuedOn: string | null;
  learnerLicenceFirstIssuedOn: string | null;
  hptPassedOn: string | null;
  loggedHours: number | null;
  loggedHoursOn: string | null;
};

const isoOf = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;

/**
 * D12: calendar months, clamped FORWARD. A day that does not exist in the target month rolls to the 1st of the
 * next month (31 Aug + 6 months = 1 Mar; 29 Feb + 12 months = 1 Mar). Negative `months` go back with the same
 * rule. Returns null for an invalid date.
 */
export function addMonthsClamped(date: string, months: number): string | null {
  const parsed = parseIsoDate(date);
  if (!parsed) return null;
  const total = parsed.y * 12 + (parsed.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12 + 12) % 12 + 1;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return parsed.d > daysInMonth ? (m === 12 ? isoOf(y + 1, 1, 1) : isoOf(y, m + 1, 1)) : isoOf(y, m, parsed.d);
}

export function addDaysIso(date: string, days: number): string | null {
  const parsed = parseIsoDate(date);
  if (!parsed) return null;
  const next = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d) + days * DAY_MS);
  return isoOf(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** D21: an ACT learner licence expires 5 years after issue, so the issue date is estimated as expiry minus 5 years (29 Feb -> 1 Mar). */
export function estimateIssueFromExpiry(licenceExpiry: string): string | null {
  return addMonthsClamped(licenceExpiry, -60);
}

/** D15: the instrument's definition, "new" = issued or renewed on or after 1 January 2020. */
export const NEW_LICENCE_FROM = "2020-01-01";
/** D21: how far the estimated issue date is moved either way to test whether the result is stable. */
export const ESTIMATE_BORDERLINE_DAYS = 14;
export const ESTIMATE_LABEL = "estimated from the licence expiry";

type Condition = { key: string; met: boolean | "unknown"; text: string };
type Evaluation = { missing: string[]; conditions: Condition[]; unclear: boolean; kind: string };

/** One reading of R2 for a concrete issue date. Pure; `onDate` is the day the Competency 23 drive would happen (D13). */
function evaluateEligibility(learner: EligibilityLearner, issue: string, onDate: string): Evaluation {
  const missing: string[] = [];
  const conditions: Condition[] = [];
  const dob = learner.dob && parseIsoDate(learner.dob) ? learner.dob : null;
  if (!dob) missing.push("date of birth");
  const isOld = issue < NEW_LICENCE_FROM;
  const dueText = (label: string, metOn: string | null) => (metOn ? `${label} on ${formatDate(metOn)}` : label);

  if (isOld) {
    // Old licence: age at least 16 years 350 days (17th birthday minus 15 days) and held at least 5½ months (D12, Q5).
    const heldFrom = learner.learnerLicenceFirstIssuedOn && parseIsoDate(learner.learnerLicenceFirstIssuedOn) ? learner.learnerLicenceFirstIssuedOn : issue;
    const heldOn = addDaysIso(addMonthsClamped(heldFrom, 5) ?? heldFrom, 16);
    if (heldOn) conditions.push({ key: "held", met: onDate >= heldOn, text: dueText("licence held 5½ months", heldOn) });
    if (dob) {
      const ageOn = addDaysIso(addMonthsClamped(dob, 17 * 12) ?? dob, -15);
      if (ageOn) conditions.push({ key: "age", met: onDate >= ageOn, text: dueText("age 16 years 350 days", ageOn) });
    }
    return { missing, conditions, unclear: false, kind: "old licence" };
  }

  // New licence: HPT and logged hours are needed whatever the band.
  if (!learner.hptPassedOn || !parseIsoDate(learner.hptPassedOn)) missing.push("HPT pass date");
  if (learner.loggedHours === null) missing.push("logged hours");
  else if (!learner.loggedHoursOn || !parseIsoDate(learner.loggedHoursOn)) missing.push("logged hours as-of date");
  if (missing.length) return { missing, conditions, unclear: false, kind: "new licence" };

  const under25At = (issuedOn: string) => {
    const twentyFifth = dob ? addMonthsClamped(dob, 25 * 12) : null;
    return twentyFifth ? issuedOn < twentyFifth : true;
  };
  const first = learner.learnerLicenceFirstIssuedOn && parseIsoDate(learner.learnerLicenceFirstIssuedOn) ? learner.learnerLicenceFirstIssuedOn : null;
  if (!dob) return { missing, conditions, unclear: false, kind: "new licence" };
  if (first && first !== issue && under25At(first) !== under25At(issue)) {
    return { missing, conditions, unclear: true, kind: "new licence" };
  }
  const under25 = under25At(issue);
  const needHours = under25 ? 100 : 50;
  const needMonths = under25 ? 12 : 6;
  const hours = learner.loggedHours as number;
  const hoursOn = learner.loggedHoursOn as string;
  if (hoursOn > onDate) {
    conditions.push({ key: "hours", met: "unknown", text: `logged hours were recorded on ${formatDate(hoursOn)}, after this date, so ${needHours} hours cannot be checked for it` });
  } else {
    conditions.push({ key: "hours", met: hours >= needHours, text: `${hours} of ${needHours} logged hours (as of ${formatDate(hoursOn)})` });
  }
  const heldOn = addMonthsClamped(issue, needMonths);
  if (heldOn) conditions.push({ key: "held", met: onDate >= heldOn, text: dueText(`licence held ${needMonths} months`, heldOn) });
  const hpt = learner.hptPassedOn as string;
  conditions.push({ key: "hpt", met: hpt <= onDate, text: `HPT passed on ${formatDate(hpt)}, after this date` });
  if (under25) {
    const ageOn = addMonthsClamped(dob, 17 * 12);
    if (ageOn) conditions.push({ key: "age", met: onDate >= ageOn, text: dueText("age 17", ageOn) });
  }
  return { missing, conditions, unclear: false, kind: under25 ? "new licence, under 25 at issue" : "new licence, 25 or over at issue" };
}

const signatureOf = (evaluation: Evaluation) => JSON.stringify([evaluation.kind, evaluation.unclear, evaluation.conditions.map((c) => [c.key, c.met])]);

const listOf = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/**
 * R2 (NI2020-703 Competency 23; CoP 9.2 k-l): Competency 23 eligibility per the entered data, on `onDate` (D13: today in
 * the Start Lesson panel, the draft lesson date in the form). The licence type (old/new) comes from the issue date (D15);
 * with no typed issue date it is estimated from the licence expiry (D21), always labelled, and a result that changes when
 * the estimate moves 14 days either way is "Borderline", never a pass. Missing data is a neutral "add X" (never a pass).
 */
export function finalDriveEligibilityReminder(learner: EligibilityLearner, onDate: string): Reminder {
  const id = "r2";
  if (!parseIsoDate(onDate)) return { id, tone: "grey", text: "Add the lesson date to check Competency 23 eligibility." };
  // An expired learner licence (expiry before the checking date; the expiry day itself is still current, D14) is never a pass.
  if (learner.licenceExpiry && parseIsoDate(learner.licenceExpiry) && learner.licenceExpiry < onDate) {
    return { id, tone: "grey", text: `Learner licence expired ${formatDate(learner.licenceExpiry)}: update the licence details to check Competency 23 eligibility.` };
  }
  const typedIssue = learner.learnerLicenceIssuedOn && parseIsoDate(learner.learnerLicenceIssuedOn) ? learner.learnerLicenceIssuedOn : null;
  const estimate = !typedIssue && learner.licenceExpiry ? estimateIssueFromExpiry(learner.licenceExpiry) : null;
  const issue = typedIssue ?? estimate;
  const addNote = (missing: string[]): Reminder => ({ id, tone: "grey", text: `Add ${listOf(missing)} to check Competency 23 eligibility.` });

  if (!issue) {
    const missing = ["licence issue date"];
    if (!learner.dob) missing.push("date of birth");
    if (!learner.hptPassedOn) missing.push("HPT pass date");
    if (learner.loggedHours === null) missing.push("logged hours");
    return addNote(missing);
  }

  const readings = estimate
    ? [addDaysIso(issue, -ESTIMATE_BORDERLINE_DAYS), issue, addDaysIso(issue, ESTIMATE_BORDERLINE_DAYS)].map((date) => evaluateEligibility(learner, date as string, onDate))
    : [evaluateEligibility(learner, issue, onDate)];
  const missing = [...new Set(readings.flatMap((reading) => reading.missing))];
  if (missing.length) return addNote(missing);

  const main = readings[estimate ? 1 : 0];
  const estimateText = `licence issue date ${ESTIMATE_LABEL} (${formatDate(issue)})`;
  if (estimate && new Set(readings.map(signatureOf)).size > 1) {
    return { id, tone: "amber", text: `Borderline, check the licence card: the ${estimateText} could be a few days out, which changes the Competency 23 result.` };
  }
  if (main.unclear) return { id, tone: "grey", text: "Age band unclear for a renewed licence: check the instrument (the first and current issue dates are in different age bands)." };

  const unmet = main.conditions.filter((condition) => condition.met === false);
  const unknown = main.conditions.filter((condition) => condition.met === "unknown");
  const suffix = estimate ? ` (${estimateText})` : "";
  if (unmet.length) return { id, tone: "amber", text: `Competency 23 not yet: ${unmet.map((c) => c.text).join("; ")}.${suffix}` };
  if (unknown.length) return { id, tone: "grey", text: `Cannot check Competency 23 eligibility: ${unknown.map((c) => c.text).join("; ")}.${suffix}` };
  return { id, tone: "plain", text: `Competency 23 eligibility met per entered data (${main.kind}${estimate ? `; ${estimateText}` : ""}).` };
}
