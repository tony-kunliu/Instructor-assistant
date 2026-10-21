import { distanceKm, durationMinutes, parseOdometer } from "./calc.ts";

// Save-failure UX: a plain list of "what's wrong + which field" that the form
// renders next to the Save button, each with a jump-to-field action.

export type FormFieldId = "date" | "times" | "start-odometer" | "finish-odometer" | "competency" | "adi-signature" | "learner-signature";

export const FIELD_LABELS: Record<FormFieldId, string> = {
  date: "Date",
  times: "Start / finish time",
  "start-odometer": "Start odometer",
  "finish-odometer": "Finish odometer",
  competency: "CBT&A competencies",
  "adi-signature": "ADI signature",
  "learner-signature": "Learner signature",
};

/** `field` is null when the message isn't about one field (nothing to jump to). */
export type FormIssue = { field: FormFieldId | null; message: string };

export type LessonDraftLike = {
  lessonDate: string;
  startTime: string;
  finishTime: string;
  startOdometer: string;
  finishOdometer: string;
  taughtIds: string[];
  assessedIds: string[];
  achievedResults: Record<string, string>;
  location: string;
  comments: string;
  adiSignature: string;
  learnerSignature: string;
};

/** "paper" = History Edit of a paper_import lesson: times / odometer optional (both or neither), no signature pads. */
export type FormMode = "new" | "edit" | "paper";

// Top-to-bottom order of each form, so the first issue listed is the first one on the page.
const ORDER: Record<FormMode, FormFieldId[]> = {
  new: ["start-odometer", "finish-odometer", "competency", "date", "times", "adi-signature", "learner-signature"],
  edit: ["date", "times", "start-odometer", "finish-odometer", "competency", "adi-signature", "learner-signature"],
  paper: ["date", "times", "start-odometer", "finish-odometer", "competency"],
};

/** Draft keys whose change means the user has touched the problem (used to clear a server-reported issue). */
export const DRAFT_KEYS_BY_FIELD: Record<FormFieldId, (keyof LessonDraftLike)[]> = {
  date: ["lessonDate"],
  times: ["startTime", "finishTime"],
  "start-odometer": ["startOdometer"],
  "finish-odometer": ["finishOdometer", "startOdometer"],
  competency: ["taughtIds", "assessedIds", "achievedResults"],
  "adi-signature": ["adiSignature", "learnerSignature"],
  "learner-signature": ["adiSignature", "learnerSignature"],
};

/**
 * Mirrors the server's own checks (lib/repo.ts) so the common mistakes are caught before a round trip.
 * `signLater` (Tony 2026-10-22): the lesson may be saved with neither signature and signed later, so only one
 * signature without the other is a problem.
 */
export function validateLessonDraftFields(draft: LessonDraftLike, mode: FormMode, options: { signLater?: boolean } = {}): FormIssue[] {
  const found = new Map<FormFieldId, string>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.lessonDate.trim())) found.set("date", "Lesson date is required.");
  if (mode === "paper") {
    const hasStart = draft.startTime.trim() !== "";
    const hasFinish = draft.finishTime.trim() !== "";
    if (hasStart !== hasFinish) found.set("times", "Enter both start and finish time, or leave both blank.");
    else if (hasStart && durationMinutes(draft.startTime, draft.finishTime) === null) found.set("times", "Start and finish time are required, and finish must be after start.");
    const startRaw = draft.startOdometer.trim();
    const finishRaw = draft.finishOdometer.trim();
    if ((startRaw === "") !== (finishRaw === "")) found.set("start-odometer", "Enter both start and finish odometer, or leave both blank.");
    else if (startRaw !== "") {
      const a = parseOdometer(startRaw);
      const b = parseOdometer(finishRaw);
      if (a === null || b === null) found.set("start-odometer", "Odometer readings must be whole km.");
      else if (distanceKm(a, b) === null) found.set("finish-odometer", "Finish odometer must not be less than start odometer.");
    }
    if (draft.assessedIds.some((id) => !(id in draft.achievedResults))) found.set("competency", "Mark Achieved / Not achieved for every Assessed competency.");
    return ORDER.paper.filter((field) => found.has(field)).map((field) => ({ field, message: found.get(field)! }));
  }
  if (durationMinutes(draft.startTime, draft.finishTime) === null) found.set("times", "Start and finish time are required, and finish must be after start.");
  const start = parseOdometer(draft.startOdometer);
  const finish = parseOdometer(draft.finishOdometer);
  if (start === null) found.set("start-odometer", "Start odometer is required.");
  if (finish === null) found.set("finish-odometer", "Finish odometer is required.");
  else if (start !== null && distanceKm(start, finish) === null) found.set("finish-odometer", "Finish odometer must not be less than start odometer.");
  if (draft.assessedIds.some((id) => !(id in draft.achievedResults))) found.set("competency", "Mark Achieved / Not achieved for every Assessed competency.");
  if (options.signLater && !draft.adiSignature !== !draft.learnerSignature) {
    found.set(draft.adiSignature ? "learner-signature" : "adi-signature", "Sign with both signatures, or clear both to sign later.");
  } else if (!options.signLater) {
    if (!draft.adiSignature) found.set("adi-signature", "ADI signature is required.");
    if (!draft.learnerSignature) found.set("learner-signature", "Learner signature is required.");
  }
  return ORDER[mode].filter((field) => found.has(field)).map((field) => ({ field, message: found.get(field)! }));
}

const SERVER_RULES: [RegExp, FormFieldId][] = [
  [/^finish odometer/i, "finish-odometer"],
  [/^start odometer/i, "start-odometer"],
  [/lesson date/i, "date"],
  [/start and finish time/i, "times"],
  [/both signatures, or/i, "adi-signature"],
  [/ADI signature/i, "adi-signature"],
  [/learner signature/i, "learner-signature"],
  [/signatures? .*(redrawn|redraw|no longer valid)/i, "adi-signature"],
  [/competenc|review 1-|final drive|assess|taught|achieved/i, "competency"],
];

/** Maps a server validation message to the field it is about (the message itself is shown unchanged). */
export function issueFromServerMessage(message: string): FormIssue {
  const text = message.trim();
  if (!text) return { field: null, message: "Could not save. Please try again." };
  // Not about a field the user can fix in the form.
  if (/already completed/i.test(text)) return { field: null, message: text };
  const rule = SERVER_RULES.find(([pattern]) => pattern.test(text));
  return { field: rule ? rule[1] : null, message: text };
}

/**
 * How issues are held until corrected.
 * - "client": the list is recomputed live from the current draft, so each
 *   problem disappears the moment it is fixed and the summary empties when all are.
 * - "server": the server's single message stays visible until the field it
 *   is about changes (or, with no field, until the next save attempt replaces it).
 */
export type IssueState = { source: "client" | "server"; issues: FormIssue[]; snapshot: LessonDraftLike };

export function currentIssues(state: IssueState | null, draft: LessonDraftLike, mode: FormMode): FormIssue[] {
  if (!state) return [];
  if (state.source === "client") return validateLessonDraftFields(draft, mode);
  const [issue] = state.issues;
  if (!issue?.field) return state.issues;
  const changed = DRAFT_KEYS_BY_FIELD[issue.field].some((key) => JSON.stringify(draft[key]) !== JSON.stringify(state.snapshot[key]));
  return changed ? [] : state.issues;
}
