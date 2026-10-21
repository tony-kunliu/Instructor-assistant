// "Paste from assistant" (Tony 2026-10-22): a personal assistant turns what the instructor says after a lesson into a
// fixed-format text block; the instructor copies it and pastes it into the app, which only PRE-FILLS a form. Nothing is
// saved from a draft: the instructor checks it, both signatures are taken in the app, and the normal save validates it.
//
// Format (one "Key: value" per line; keys case-insensitive; a line without a known key continues the previous value):
//   ACTGDS-DRAFT LESSON                      ACTGDS-DRAFT LEARNER
//   Learner: Jane Citizen                    Name: Jane Citizen
//   Date: 2026-10-22                         Instructor: Tony
//   Start: 09:00                             Phone / DOB / Licence number / Licence expiry / Address /
//   Finish: 10:00                            School / Work / Manual / Auto / Eligibility
//   Start odometer: 12345
//   Finish odometer: 12370
//   Taught: 1, 2, 3
//   Assessed: 4, 5, Review 1-17
//   Achieved: 4, Review 1-17
//   Location: Belconnen
//   Comments: free text
// Values like "not provided", "未提供", "-" or "—" mean empty. Nothing is guessed: unknown or invalid values are reported.

import { ALL_ASSESSABLE_IDS, CORE_COMPETENCY_IDS, FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22, type AssessmentResult } from "./competency.ts";

export const DRAFT_MARKER = "ACTGDS-DRAFT";

export type LessonDraftFields = {
  learnerName: string;
  lessonDate: string;
  startTime: string;
  finishTime: string;
  startOdometer: string;
  finishOdometer: string;
  taughtIds: string[];
  assessedIds: string[];
  achievedResults: Record<string, AssessmentResult>;
  location: string;
  comments: string;
};

export type LearnerDraftFields = {
  fullName: string;
  instructorName: string;
  phone: string;
  dob: string;
  licenceNumber: string;
  licenceExpiry: string;
  address: string;
  schoolWork: string;
  transmission: "" | "manual" | "auto";
  eligibility: string;
};

export type AssistantDraft =
  | { kind: "lesson"; fields: LessonDraftFields; problems: string[] }
  | { kind: "learner"; fields: LearnerDraftFields; problems: string[] };

const EMPTY = new Set(["", "-", "—", "–", "n/a", "na", "none", "not provided", "not given", "unknown", "未提供", "无", "没有"]);
const clean = (v: string) => (EMPTY.has(v.trim().toLowerCase()) ? "" : v.trim());

const LESSON_KEYS: Record<string, keyof LessonDraftFields> = {
  learner: "learnerName", "learner name": "learnerName", name: "learnerName",
  date: "lessonDate", start: "startTime", "start time": "startTime", finish: "finishTime", "finish time": "finishTime", end: "finishTime",
  "start odometer": "startOdometer", "finish odometer": "finishOdometer", "end odometer": "finishOdometer",
  taught: "taughtIds", assessed: "assessedIds", achieved: "achievedResults",
  location: "location", comments: "comments", comment: "comments", notes: "comments",
};
const LEARNER_KEYS: Record<string, keyof LearnerDraftFields> = {
  name: "fullName", "student name": "fullName", learner: "fullName", instructor: "instructorName",
  phone: "phone", dob: "dob", "date of birth": "dob", "licence number": "licenceNumber", "license number": "licenceNumber",
  "licence expiry": "licenceExpiry", "license expiry": "licenceExpiry", address: "address",
  "school / work": "schoolWork", "school/work": "schoolWork", school: "schoolWork", "manual / auto": "transmission",
  "manual/auto": "transmission", transmission: "transmission", eligibility: "eligibility",
};

/** "Review 1-17", "R1-17", "review-1-17", "Final Drive 23", "23", "7" → canonical ids; anything else is null. */
export function competencyIdFromText(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");
  if (CORE_COMPETENCY_IDS.includes(t)) return t;
  if (/^(review|r) ?1 ?- ?17$|^review-1-17$/.test(t)) return REVIEW_1_17;
  if (/^(review|r) ?1 ?- ?22$|^review-1-22$/.test(t)) return REVIEW_1_22;
  if (/^(23|23 final drive|final drive( 23)?|final-drive-23)$/.test(t)) return FINAL_DRIVE_23;
  return null;
}

function idList(value: string, label: string, problems: string[]): string[] {
  const out: string[] = [];
  for (const part of value.split(/[,，;、]/)) {
    if (!clean(part)) continue;
    const id = competencyIdFromText(part);
    if (!id) problems.push(`${label}: "${part.trim()}" is not a CBT&A number (1-22, Review 1-17, Review 1-22, Final Drive 23).`);
    else if (!out.includes(id)) out.push(id);
  }
  return out;
}

function splitLines(text: string): { kind: string; pairs: [string, string][] } | null {
  const lines = text.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => l.trim().toUpperCase().startsWith(DRAFT_MARKER));
  if (start < 0) return null;
  const kind = lines[start].trim().slice(DRAFT_MARKER.length).trim().toLowerCase();
  const pairs: [string, string][] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("```")) break;
    const m = /^\s*([A-Za-z][A-Za-z /]*?)\s*[:：]\s*(.*)$/.exec(line);
    if (m) pairs.push([m[1].toLowerCase().replace(/\s+/g, " "), m[2]]);
    else if (pairs.length && line.trim()) pairs[pairs.length - 1][1] += `\n${line.trim()}`;
  }
  return { kind, pairs };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseAssistantDraft(text: string): AssistantDraft | { kind: "none"; problems: string[] } {
  const split = splitLines(text);
  if (!split) return { kind: "none", problems: [`No ${DRAFT_MARKER} block found. Copy the whole draft from the assistant, including its first line.`] };
  const problems: string[] = [];
  if (split.kind === "lesson") {
    const f: LessonDraftFields = { learnerName: "", lessonDate: "", startTime: "", finishTime: "", startOdometer: "", finishOdometer: "", taughtIds: [], assessedIds: [], achievedResults: {}, location: "", comments: "" };
    let achievedText = "";
    for (const [key, raw] of split.pairs) {
      const field = LESSON_KEYS[key];
      if (!field) { problems.push(`Unknown line "${key}" was ignored.`); continue; }
      const value = clean(raw);
      if (field === "taughtIds") f.taughtIds = idList(value, "Taught", problems);
      else if (field === "assessedIds") f.assessedIds = idList(value, "Assessed", problems);
      else if (field === "achievedResults") achievedText = value;
      else if (field === "startOdometer" || field === "finishOdometer") f[field] = value.replace(/[,\s]|km/gi, "");
      else f[field] = value;
    }
    const achieved = idList(achievedText, "Achieved", problems);
    for (const id of achieved) if (!f.assessedIds.includes(id)) problems.push(`Achieved ${id} is not in Assessed; add it to Assessed or remove it.`);
    for (const id of f.assessedIds) f.achievedResults[id] = achieved.includes(id) ? "achieved" : "not_achieved";
    for (const id of f.taughtIds) if (f.assessedIds.includes(id) && CORE_COMPETENCY_IDS.includes(id)) problems.push(`Competency ${id} is both Taught and Assessed; keep it in one of them.`);
    for (const id of f.taughtIds) if (!CORE_COMPETENCY_IDS.includes(id)) problems.push(`Taught can only hold 1-22, not ${id}.`);
    f.taughtIds = f.taughtIds.filter((id) => CORE_COMPETENCY_IDS.includes(id));
    if (!f.learnerName) problems.push("Learner name is missing.");
    if (f.lessonDate && !DATE.test(f.lessonDate)) { problems.push(`Date "${f.lessonDate}" must look like 2026-10-22.`); f.lessonDate = ""; }
    for (const k of ["startTime", "finishTime"] as const) if (f[k] && !TIME.test(f[k])) { problems.push(`${k === "startTime" ? "Start" : "Finish"} time "${f[k]}" must look like 09:30.`); f[k] = ""; }
    for (const k of ["startOdometer", "finishOdometer"] as const) if (f[k] && !/^\d+$/.test(f[k])) { problems.push(`${k === "startOdometer" ? "Start" : "Finish"} odometer "${f[k]}" must be whole kilometres.`); f[k] = ""; }
    for (const id of f.assessedIds) if (!ALL_ASSESSABLE_IDS.includes(id)) problems.push(`Assessed ${id} is not assessable.`);
    return { kind: "lesson", fields: f, problems };
  }
  if (split.kind === "learner") {
    const f: LearnerDraftFields = { fullName: "", instructorName: "", phone: "", dob: "", licenceNumber: "", licenceExpiry: "", address: "", schoolWork: "", transmission: "", eligibility: "" };
    for (const [key, raw] of split.pairs) {
      const field = LEARNER_KEYS[key];
      if (!field) { problems.push(`Unknown line "${key}" was ignored.`); continue; }
      const value = clean(raw);
      if (field === "transmission") {
        const t = value.toLowerCase();
        if (!t) f.transmission = "";
        else if (/^(manual|手动)/.test(t)) f.transmission = "manual";
        else if (/^(auto|automatic|自动)/.test(t)) f.transmission = "auto";
        else problems.push(`Manual / Auto "${value}" must be Manual or Auto.`);
      } else f[field] = value;
    }
    if (!f.fullName) problems.push("Student name is missing.");
    for (const k of ["dob", "licenceExpiry"] as const) if (f[k] && !DATE.test(f[k])) { problems.push(`${k === "dob" ? "DOB" : "Licence expiry"} "${f[k]}" must look like 2026-10-22.`); f[k] = ""; }
    return { kind: "learner", fields: f, problems };
  }
  return { kind: "none", problems: [`"${split.kind || "(blank)"}" after ${DRAFT_MARKER} must be LESSON or LEARNER.`] };
}

/** Learners whose name matches the draft's, ignoring case and extra spaces. The caller refuses anything but exactly one. */
export function matchLearnersByName<T extends { fullName: string }>(learners: readonly T[], name: string): T[] {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return learners.filter((l) => norm(l.fullName) === norm(name));
}
