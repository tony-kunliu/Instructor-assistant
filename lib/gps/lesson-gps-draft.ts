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
