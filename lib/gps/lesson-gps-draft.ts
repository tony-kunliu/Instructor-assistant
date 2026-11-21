import { MAX_COMMENTS_LENGTH } from "../route-check.ts";
import type { LessonGpsNotes } from "./lesson-gps-notes.ts";

export type LessonGpsDraft = {
  id: string;
  instructorId: string;
  endedAt?: number;
  /** Undefined while reading the recording, null when no useful fixes were captured. */
  notes?: LessonGpsNotes | null;
  commentsEdited?: boolean;
  /** If the GPS notes arrived after a signature, inserting them requires a fresh review. */
  needsReview?: boolean;
};

export function appendLessonGpsNotes(comments: string, notes: LessonGpsNotes, maxLength: number): string | null {
  const separator = comments.trim() ? "\n" : "";
  const full = notes.details.length ? `${notes.line}\n${notes.details.join("\n")}` : notes.line;
  if (comments.length + separator.length + notes.line.length > maxLength) return null;
  if (comments.length + separator.length + full.length <= maxLength) return `${comments}${separator}${full}`;
  // Preserve the teacher's original entry and the totals. Long lessons can exceed the comments field's limit.
  return `${comments}${separator}${notes.line}`;
}

export function lessonCommentsWithGps(comments: string, gps: LessonGpsDraft | undefined) {
  if (!gps?.notes || gps.commentsEdited || gps.needsReview) return comments;
  return appendLessonGpsNotes(comments, gps.notes, MAX_COMMENTS_LENGTH) ?? comments;
}
