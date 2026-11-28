import { MAX_COMMENTS_LENGTH } from "../route-check.ts";
import type { LessonGpsNotes } from "./lesson-gps-notes.ts";

export type LessonGpsStatus = "recording" | "ended" | "collected" | "discarded";

export type LessonGpsDraft = {
  id: string;
  instructorId: string;
  /** The tab that started this session. Only that tab may stop, collect or delete the recording. */
  tabId: string;
  startedAt: number;
  endedAt?: number;
  status: LessonGpsStatus;
  /** The lesson was saved while another tab was still editing this session. */
  savedLessonNo?: number;
  /** Undefined while reading the recording, null when no useful fixes were captured. */
  notes?: LessonGpsNotes | null;
  commentsEdited?: boolean;
  /** The instructor edited the Location field after the GPS route appeared: stop suggesting it. */
  locationEdited?: boolean;
  /** If the GPS notes arrived after a signature, inserting them requires a fresh review. */
  needsReview?: boolean;
};

/**
 * The Location shown in the checklist: the instructor's own text when there is any, else the
 * GPS route summary (the named streets passed) — unless the instructor cleared the field on
 * purpose (`locationEdited`). The route is a suggestion, never a fact: it names streets, not
 * suburbs, and only covers the ACT. Mirrors `lessonCommentsWithGps`.
 */
export function lessonLocationWithGps(location: string, gps: LessonGpsDraft | undefined): string {
  if (location.trim() || !gps?.notes?.route || gps.locationEdited) return location;
  return gps.notes.route;
}

/**
 * True when this tab owns the session and may mutate it. A tab that merely loaded the draft — or a draft
 * written before ownership existed (no tabId) — must never stop, collect or delete another tab's recording.
 */
export function ownsGpsSession(gps: LessonGpsDraft | undefined, tabId: string): gps is LessonGpsDraft {
  return gps !== undefined && gps.tabId === tabId;
}

/** A GPS session that has been ended: `endedAt` is set and never changes afterwards. */
export type EndedLessonGpsDraft = LessonGpsDraft & { endedAt: number };

/**
 * True when a session this tab owns was ended in another tab: same session id, and the stored copy
 * gained an `endedAt` this tab's copy does not have. The owning tab must then stop its recorder and
 * collect the notes itself — its own copy has no finishTime, so its collect effect never runs, and
 * without this the recording runs on as an orphan while the ending tab never sees the notes.
 */
export function gpsSessionEndedElsewhere(prev: LessonGpsDraft | undefined, cur: LessonGpsDraft | undefined, tabId: string): cur is EndedLessonGpsDraft {
  return prev !== undefined && ownsGpsSession(prev, tabId) && cur !== undefined && cur.id === prev.id && prev.endedAt === undefined && cur.endedAt !== undefined;
}

/** The fields `withGpsNotes` needs: a GPS session slot plus the signatures that decide `needsReview`. */
export type GpsNotesDraft = {
  lessonGps?: LessonGpsDraft;
  adiSignature?: string;
  learnerSignature?: string;
};

/**
 * Merge collected GPS notes into a draft holding the same session: status becomes "collected" and
 * `needsReview` records whether a signature was already present when the notes arrived (the same rule
 * the same-tab collect effect applies, so notes never slip into Comments after signing). Returns null
 * when the draft holds no session, a different session, or notes already — the caller then leaves the
 * stored draft untouched.
 */
export function withGpsNotes<T extends GpsNotesDraft>(draft: T, sessionId: string, notes: LessonGpsNotes | null): T | null {
  const gps = draft.lessonGps;
  if (!gps || gps.id !== sessionId || gps.notes !== undefined) return null;
  return {
    ...draft,
    lessonGps: { ...gps, notes, status: "collected", needsReview: Boolean(draft.adiSignature || draft.learnerSignature) },
  };
}

export function appendLessonGpsNotes(comments: string, notes: LessonGpsNotes, maxLength: number): string | null {
  const separator = comments.trim() ? "\n" : "";
  if (comments.length + separator.length + notes.line.length > maxLength) return null;
  // Detailed junction times and names are for local review. Comments appear on the official PDF.
  return `${comments}${separator}${notes.line}`;
}

export function lessonCommentsWithGps(comments: string, gps: LessonGpsDraft | undefined) {
  if (!gps?.notes || gps.commentsEdited || gps.needsReview) return comments;
  return appendLessonGpsNotes(comments, gps.notes, MAX_COMMENTS_LENGTH) ?? comments;
}
