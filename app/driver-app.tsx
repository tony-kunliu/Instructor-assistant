"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decimalHours,
  distanceKm,
  durationMinutes,
  canberraDateTime,
  EMPTY_TOTALS,
  formatMinutes,
  localNow,
  nextLessonNo,
  parseOdometer,
  parseTime,
  type Totals,
} from "@/lib/calc.ts";
import { FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22, invalidationNotice, type AssessmentResult, type LearnerProgress, type MilestoneInvalidation } from "@/lib/competency.ts";
import { accessLogoutUrl } from "@/lib/access-logout.ts";
import { ARCHIVE_REASONS, archiveReasonText, MAX_ARCHIVE_NOTE_LENGTH } from "@/lib/archive-reasons.ts";
import { filterLearners } from "@/lib/learner-filter.ts";
import { MAX_TRANSFER_NOTE_LENGTH, pendingRecordsCheck, recordsCheckText, transferLine, withTransferDividers } from "@/lib/learner-transfer.ts";
import { archivedNotCheckedReminder, duplicateLicenceReminder, missingPdfReminder, sameLicenceLearners } from "@/lib/learner-checks.ts";
import { currentIssues, issueFromServerMessage, validateLessonDraftFields, type IssueState } from "@/lib/lesson-form-errors.ts";
import { availableViews, initialSelection, learnerPanel, selectionAfterViewChange, viewLearners, type PickerView } from "@/lib/learner-picker.ts";
import { priorRecordLine, splitPriorRecords } from "@/lib/prior-record.ts";
import { revisionChanges, snapshotOfLesson } from "@/lib/revision-diff.ts";
import type { CompletionSummary, Instructor, Learner, LearnerArchiveEvent, Lesson, LessonRevision, SignatureStatus } from "@/lib/types.ts";
import CompetencyPicker from "./competency-picker.tsx";
import CompetencyProgressCard from "./competency-progress.tsx";
import ExportPdfButton from "./export-pdf-button.tsx";
import SaveErrorSummary from "./save-error-summary.tsx";
import PaperImportPanel from "./paper-import-panel.tsx";
import SignaturePad from "./signature-pad.tsx";
import { BookingLink, RulesReminders } from "./rules-reminders.tsx";
import { finalDriveEligibilityReminder, finalDriveEligibleFromReminder, finalDriveFormReminders, finalDrivePanelReminder, learnerLicenceReminder, reviewGapReminder, type EligibilityLearner, type Reminder } from "@/lib/rules.ts";
import { autoFillEligibility, ELIGIBILITY_DATE_KEYS, eligibilityAtSave, showsAutoHint } from "@/lib/c23-eligibility.ts";
import { applyRoute, defaultRouteState, homeDistrict, parseRouteComments, routeSuggestionReminder, syncRouteWithAssessed, type RouteState } from "@/lib/route-check.ts";
import RouteCheckGroup from "./route-check.tsx";

type LessonDraft = {
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
  adiSignature: string;
  learnerSignature: string;
};

type LearnerDraft = {
  fullName: string;
  address: string;
  phone: string;
  dob: string;
  licenceNumber: string;
  licenceExpiry: string;
  /** Competency 23 eligibility group (migration 0009); all optional. Hours are digits only. */
  learnerLicenceIssuedOn: string;
  learnerLicenceFirstIssuedOn: string;
  hptPassedOn: string;
  loggedHours: string;
  loggedHoursOn: string;
  eligibility: string;
  transmission: string;
  schoolWork: string;
  /** Edit form only (createLearner ignores it). */
  licenceStage: string;
  /** Must be an existing, active instructor's id — selected from a dropdown, never free-typed (see lib/repo.ts#createLearner). */
  instructorId: string;
};

type Detail = { learner: Learner; totals: Totals; lessons: Lesson[]; progress: LearnerProgress; completion: CompletionSummary | null };

const byName = (a: Learner, b: Learner) => a.fullName.localeCompare(b.fullName);

/** The form's Competency 23 inputs as the rules read them ("" = not recorded). */
function draftEligibilityLearner(d: LearnerDraft): EligibilityLearner {
  const date = (v: string) => v || null;
  return {
    dob: date(d.dob), licenceExpiry: date(d.licenceExpiry), learnerLicenceIssuedOn: date(d.learnerLicenceIssuedOn),
    learnerLicenceFirstIssuedOn: date(d.learnerLicenceFirstIssuedOn), hptPassedOn: date(d.hptPassedOn),
    loggedHours: /^\d+$/.test(d.loggedHours) ? Number(d.loggedHours) : null, loggedHoursOn: date(d.loggedHoursOn),
  };
}

/** D18: after a licence-date/DOB edit, an empty or app-generated Eligibility follows the dates ("C23 from …"); the instructor's own text is never touched. */
function withAutoEligibility(d: LearnerDraft): LearnerDraft {
  const eligibility = autoFillEligibility(d.eligibility, draftEligibilityLearner(d));
  return eligibility === d.eligibility ? d : { ...d, eligibility };
}

/** D18 at save: an empty Eligibility box is saved as the generated value (when one can be computed). */
function withSaveEligibility(d: LearnerDraft): LearnerDraft {
  const eligibility = eligibilityAtSave(d.eligibility, draftEligibilityLearner(d));
  return eligibility === d.eligibility ? d : { ...d, eligibility };
}

const isEligibilityDateKey = (key: keyof LearnerDraft) => (ELIGIBILITY_DATE_KEYS as readonly string[]).includes(key);

const emptyLearner: LearnerDraft = {
  fullName: "",
  address: "",
  phone: "",
  dob: "",
  licenceNumber: "",
  licenceExpiry: "",
  learnerLicenceIssuedOn: "",
  learnerLicenceFirstIssuedOn: "",
  hptPassedOn: "",
  loggedHours: "",
  loggedHoursOn: "",
  eligibility: "",
  transmission: "",
  schoolWork: "",
  licenceStage: "learner",
  instructorId: "",
};

function freshLesson(startOdometer: number | null): LessonDraft {
  return {
    lessonDate: localNow().date,
    startTime: "",
    finishTime: "",
    startOdometer: startOdometer === null ? "" : String(startOdometer),
    finishOdometer: "",
    taughtIds: [],
    assessedIds: [],
    achievedResults: {},
    location: "",
    comments: "",
    adiSignature: "",
    learnerSignature: "",
  };
}

type LessonSelections = { taughtIds: string[]; assessedIds: string[]; achievedResults: Record<string, AssessmentResult> };

function lessonToDraft(lesson: Lesson, selections: LessonSelections): LessonDraft {
  return {
    lessonDate: lesson.lessonDate,
    startTime: lesson.startTime ?? "",
    finishTime: lesson.finishTime ?? "",
    startOdometer: lesson.startOdometer === null ? "" : String(lesson.startOdometer),
    finishOdometer: lesson.finishOdometer === null ? "" : String(lesson.finishOdometer),
    taughtIds: selections.taughtIds,
    assessedIds: selections.assessedIds,
    achievedResults: selections.achievedResults,
    location: lesson.location ?? "",
    comments: lesson.comments ?? "",
    adiSignature: lesson.adiSignature ?? "",
    learnerSignature: lesson.learnerSignature ?? "",
  };
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Fields whose change invalidates existing signatures — mirrors lib/repo.ts#updateLesson's SIGNATURE_PROTECTED_FIELDS. */
function contentChanged(a: LessonDraft, b: LessonDraft): boolean {
  return (
    a.lessonDate !== b.lessonDate ||
    a.startTime !== b.startTime ||
    a.finishTime !== b.finishTime ||
    a.startOdometer !== b.startOdometer ||
    a.finishOdometer !== b.finishOdometer ||
    !sameIds(a.taughtIds, b.taughtIds) ||
    !sameIds(a.assessedIds, b.assessedIds) ||
    JSON.stringify(a.achievedResults) !== JSON.stringify(b.achievedResults) ||
    a.location !== b.location ||
    a.comments !== b.comments
  );
}

// Per-device conveniences only (the database is the record). Wrapped so a
// private window or blocked storage never breaks the app.
const storage = {
  get(key: string): string | null {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
  },
  remove(key: string) {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  },
};
const draftKey = (learnerId: string) => `actgds-driver:draft:${learnerId}`;
const LAST_LEARNER_KEY = "actgds-driver:last-learner";
const LAST_INSTRUCTOR_KEY = "actgds-driver:last-instructor";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}

export default function DriverApp() {
  const [learners, setLearners] = useState<Learner[]>([]);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<LessonDraft | null>(null);
  const [addingLearner, setAddingLearner] = useState(false);
  // True while the learner form edits the selected learner (instead of creating one).
  const [editingLearner, setEditingLearner] = useState(false);
  // The learner the open edit form belongs to; the save targets this id, never whoever is selected at save time.
  const [editLearnerId, setEditLearnerId] = useState<string | null>(null);
  /** The Edit form exactly as opened, to tell an untouched save (sent as is) from an edited one. */
  const [openedLearnerDraft, setOpenedLearnerDraft] = useState<LearnerDraft | null>(null);
  const [learnerDraft, setLearnerDraft] = useState<LearnerDraft>(emptyLearner);
  const [status, setStatus] = useState<{ kind: "info" | "error" | "ok" | "warn"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [clock, setClock] = useState(() => localNow().time);
  const finishOdoRef = useRef<HTMLInputElement>(null);
  // Latest requested learner — lets a slow /api/learners/:id response be dropped if the selection changed meanwhile (e.g. a view switch).
  const selectedRef = useRef("");

  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<LessonDraft | null>(null);
  const [editOriginal, setEditOriginal] = useState<LessonDraft | null>(null);
  // Set while editing a paper_import lesson: optional times/odometer, "Signed on paper" select instead of signature pads.
  const [editPaperSignature, setEditPaperSignature] = useState<SignatureStatus | null>(null);
  const [editProgress, setEditProgress] = useState<LearnerProgress | null>(null);
  const [editGateProgress, setEditGateProgress] = useState<LearnerProgress | null>(null);
  // Save-failure summaries (rendered next to the Save button; see lib/lesson-form-errors.ts).
  const [saveIssues, setSaveIssues] = useState<IssueState | null>(null);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [editIssues, setEditIssues] = useState<IssueState | null>(null);
  const [editAttempt, setEditAttempt] = useState(0);
  const [editLoading, setEditLoading] = useState(false);
  // Optional reason for this correction (max 200 chars), sent with the edit and kept in the lesson's revision.
  const [editReason, setEditReason] = useState("");
  // Lazily loaded previous versions of ONE lesson at a time ("Edited N times" → open).
  const [revisionsOpenId, setRevisionsOpenId] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<LessonRevision[] | null>(null);
  const [revisionsError, setRevisionsError] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [invalidation, setInvalidation] = useState<MilestoneInvalidation | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  // Ends the Cloudflare Access session on this app's own origin and returns to it (see lib/access-logout.ts).
  const [logoutUrl, setLogoutUrl] = useState(() => accessLogoutUrl(null));
  useEffect(() => setLogoutUrl(accessLogoutUrl(window.location.origin)), []);
  const [signedInInstructorId, setSignedInInstructorId] = useState<string | null>(null);
  // Nothing identity-dependent (view, learner list) is shown until /api/me has resolved, so a device's leftover state can never flash or pick "All".
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<PickerView>("mine");
  const [query, setQuery] = useState("");
  const [archivedLearners, setArchivedLearners] = useState<Learner[] | null>(null);
  // Inline archive panel (Phase 3b): null = closed. Cancel just closes it; nothing is sent until "Archive learner" is tapped.
  const [archiveDraft, setArchiveDraft] = useState<{ reason: string; note: string } | null>(null);
  // Archive / restore events of the open archived learner, loaded lazily when "History" is opened.
  const [archiveHistory, setArchiveHistory] = useState<LearnerArchiveEvent[] | null>(null);
  const [archiveHistoryError, setArchiveHistoryError] = useState<string | null>(null);
  // Inline transfer panel (3c T1): null = closed; the only other instructor is preselected, so the common case is two taps.
  const [transferDraft, setTransferDraft] = useState<{ toId: string; note: string } | null>(null);
  const resetArchiveUi = () => {
    setTransferDraft(null);
    setArchiveDraft(null);
    setArchiveHistory(null);
    setArchiveHistoryError(null);
  };

  const totals = detail?.totals ?? EMPTY_TOTALS;

  const loadLearner = useCallback(async (id: string) => {
    selectedRef.current = id;
    setSaveIssues(null);
    setSelectedId(id);
    setDetail(null);
    setDraft(null);
    cancelEditLesson();
    // The revisions panel belongs to one loaded copy of a lesson; never keep it across a reload or an edit.
    setRevisionsOpenId(null);
    setRevisions(null);
    setRevisionsError(null);
    setInvalidation(null);
    resetArchiveUi();
    if (!id) return;
    storage.set(LAST_LEARNER_KEY, id);
    try {
      const data = await api<Detail>(`/api/learners/${encodeURIComponent(id)}`);
      if (selectedRef.current !== id) return;
      setDetail(data);
      const saved = storage.get(draftKey(id));
      setDraft(saved ? { ...freshLesson(data.totals.lastFinishOdometer), ...JSON.parse(saved) } : freshLesson(data.totals.lastFinishOdometer));
    } catch (error) {
      setStatus({ kind: "error", text: (error as Error).message });
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void (async () => {
      try {
        const [learnerData, instructorData, meData] = await Promise.all([
          api<{ learners: Learner[] }>("/api/learners"),
          api<{ instructors: Instructor[] }>("/api/instructors"),
          api<{ instructor: { id: string; fullName: string } | null }>("/api/me"),
        ]);
        setLearners(learnerData.learners);
        setInstructors(instructorData.instructors);
        setSignedInAs(meData.instructor?.fullName ?? null);
        setSignedInInstructorId(meData.instructor?.id ?? null);
        const start = initialSelection({ signedInInstructorId: meData.instructor?.id ?? null, activeLearners: learnerData.learners, lastLearnerId: storage.get(LAST_LEARNER_KEY) });
        setView(start.view);
        setReady(true);
        // Archived learners load in the background too, so the duplicate-licence check covers them; a failure just leaves the "not checked" note.
        void api<{ learners: Learner[] }>("/api/learners?status=archived")
          .then((data) => setArchivedLearners((current) => current ?? data.learners))
          .catch(() => undefined);
        if (start.learnerId) await loadLearner(start.learnerId);
        else if (!learnerData.learners.length) setAddingLearner(true);
      } catch (error) {
        setStatus({ kind: "error", text: (error as Error).message });
        setReady(true);
      }
    })();
  }, [loadLearner]);

  // Keep the in-progress lesson on this device in case the page reloads mid-lesson.
  useEffect(() => {
    if (!selectedId || !draft) return;
    if (draft.startTime) storage.set(draftKey(selectedId), JSON.stringify(draft));
  }, [selectedId, draft]);

  // Tick the elapsed-time display while a lesson is running.
  useEffect(() => {
    const timer = window.setInterval(() => setClock(localNow().time), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const setField = (key: keyof LessonDraft, value: string) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  const startLesson = () => {
    const now = localNow();
    setStatus(null);
    setDraft((current) => (current ? { ...current, lessonDate: now.date, startTime: now.time, finishTime: "" } : current));
  };

  const endLesson = () => {
    setDraft((current) => (current ? { ...current, finishTime: localNow().time } : current));
    window.setTimeout(() => finishOdoRef.current?.focus(), 50);
  };

  const discardLesson = () => {
    if (!detail || !window.confirm("Discard this lesson? Nothing will be saved.")) return;
    storage.remove(draftKey(detail.learner.id));
    setDraft(freshLesson(detail.totals.lastFinishOdometer));
    setSaveIssues(null);
    setStatus(null);
  };

  const addLearner = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const { learner } = await api<{ learner: Learner }>("/api/learners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(withSaveEligibility(learnerDraft)),
      });
      storage.set(LAST_INSTRUCTOR_KEY, learner.instructorId);
      setLearners((current) => [...current, learner].sort((a, b) => a.fullName.localeCompare(b.fullName)));
      setAddingLearner(false);
      setLearnerDraft(emptyLearner);
      await loadLearner(learner.id);
      setStatus({ kind: "ok", text: `${learner.fullName} added. Ready for Lesson #1.` });
    } catch (error) {
      setStatus({ kind: "error", text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const openEditLearner = () => {
    if (!detail) return;
    const l = detail.learner;
    const opened: LearnerDraft = {
      fullName: l.fullName, address: l.address ?? "", phone: l.phone ?? "", dob: l.dob ?? "", licenceNumber: l.licenceNumber ?? "",
      licenceExpiry: l.licenceExpiry ?? "", eligibility: l.eligibility ?? "", transmission: l.transmission ?? "", schoolWork: l.schoolWork ?? "",
      learnerLicenceIssuedOn: l.learnerLicenceIssuedOn ?? "", learnerLicenceFirstIssuedOn: l.learnerLicenceFirstIssuedOn ?? "", hptPassedOn: l.hptPassedOn ?? "",
      loggedHours: l.loggedHours === null ? "" : String(l.loggedHours), loggedHoursOn: l.loggedHoursOn ?? "",
      licenceStage: l.licenceStage, instructorId: l.instructorId,
    };
    // Opened as stored (no auto-fill yet): an untouched save must send no change. The panel and PDF show the live value anyway.
    setLearnerDraft(opened);
    setOpenedLearnerDraft(opened);
    setHoursOnTouched(false);
    setEditLearnerId(l.id);
    setEditingLearner(true);
    setAddingLearner(true);
    setStatus(null);
  };

  const closeLearnerForm = () => {
    setAddingLearner(false);
    setEditingLearner(false);
    setEditLearnerId(null);
  };

  // Switching to another learner (or none) while the edit form is open discards the form: it belongs to the learner it was opened for.
  useEffect(() => {
    if (editingLearner && editLearnerId !== null && detail?.learner.id !== editLearnerId) {
      setAddingLearner(false);
      setEditingLearner(false);
      setEditLearnerId(null);
    }
  }, [detail?.learner.id, editingLearner, editLearnerId]);

  const saveLearnerEdit = async () => {
    if (!detail || !editLearnerId || detail.learner.id !== editLearnerId) return;
    setSaving(true);
    setStatus(null);
    try {
      // Untouched form: send it exactly as opened ("No changes"). Otherwise an empty Eligibility box gets the generated value (D18).
      const untouched = openedLearnerDraft !== null && JSON.stringify(openedLearnerDraft) === JSON.stringify(learnerDraft);
      const { instructorId: _owner, ...fields } = untouched ? learnerDraft : withSaveEligibility(learnerDraft);
      void _owner;
      const result = await api<{ learner: Learner; changed: boolean; message?: string }>(`/api/learners/${encodeURIComponent(editLearnerId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      });
      const { learner } = result;
      const swap = (list: Learner[]) => list.map((l) => (l.id === learner.id ? learner : l)).sort(byName);
      setLearners(swap);
      setArchivedLearners((current) => (current ? swap(current) : current));
      setDetail((current) => (current && current.learner.id === learner.id ? { ...current, learner } : current));
      closeLearnerForm();
      setStatus({ kind: "ok", text: result.changed ? `${learner.fullName} updated.` : "No changes: the details are already up to date." });
    } catch (error) {
      setStatus({ kind: "error", text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const saveLesson = async () => {
    if (!detail || !draft) return;
    const problems = validateLessonDraftFields(draft, "new");
    if (problems.length) {
      setSaveIssues({ source: "client", issues: problems, snapshot: draft });
      setSaveAttempt((n) => n + 1);
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const result = await api<{ lesson: Lesson; totals: Totals; progress: LearnerProgress; completion: CompletionSummary | null }>(
        `/api/learners/${encodeURIComponent(detail.learner.id)}/lessons`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) },
      );
      storage.remove(draftKey(detail.learner.id));
      setSaveIssues(null);
      setDetail({ ...detail, totals: result.totals, progress: result.progress, completion: result.completion, lessons: [result.lesson, ...detail.lessons] });
      setDraft(freshLesson(result.totals.lastFinishOdometer));
      setStatus({ kind: "ok", text: `Lesson #${result.lesson.lessonNo} saved.` });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setSaveIssues({ source: "server", issues: [issueFromServerMessage((error as Error).message)], snapshot: draft });
      setSaveAttempt((n) => n + 1);
    } finally {
      setSaving(false);
    }
  };

  const startEditLesson = async (lessonId: string) => {
    if (!detail) return;
    setEditingLessonId(lessonId);
    setEditDraft(null);
    setEditIssues(null);
    setEditStatus(null);
    setEditReason("");
    setEditLoading(true);
    try {
      const data = await api<{ lesson: Lesson; selections: LessonSelections; progressExcludingThisLesson: LearnerProgress; progressBeforeThisLesson: LearnerProgress }>(
        `/api/learners/${encodeURIComponent(detail.learner.id)}/lessons/${encodeURIComponent(lessonId)}`,
      );
      const draft = lessonToDraft(data.lesson, data.selections);
      setEditDraft(draft);
      setEditOriginal(draft);
      setEditPaperSignature(data.lesson.recordSource === "paper_import" ? (data.lesson.signatureStatus === "unsigned" ? "unsigned" : "on_paper") : null);
      setEditProgress(data.progressExcludingThisLesson);
      setEditGateProgress(data.progressBeforeThisLesson);
    } catch (error) {
      setEditStatus((error as Error).message);
    } finally {
      setEditLoading(false);
    }
  };

  const cancelEditLesson = () => {
    setEditingLessonId(null);
    setEditDraft(null);
    setEditOriginal(null);
    setEditPaperSignature(null);
    setEditProgress(null);
    setEditGateProgress(null);
    setEditIssues(null);
    setEditStatus(null);
    setEditReason("");
  };

  const setEditFieldValue = (updater: (current: LessonDraft) => LessonDraft) => {
    setEditDraft((current) => {
      if (!current || !editOriginal) return current;
      const next = updater(current);
      // Any protected-field change invalidates both signatures (CBT&A V3 rule
      // 5) — clear them here too so the instructor is visibly forced to
      // redraw; the server enforces this independently regardless.
      if (!editPaperSignature && contentChanged(editOriginal, next) && (next.adiSignature === editOriginal.adiSignature || next.learnerSignature === editOriginal.learnerSignature)) {
        return { ...next, adiSignature: "", learnerSignature: "" };
      }
      return next;
    });
  };

  const toggleRevisions = async (lessonId: string) => {
    if (!detail) return;
    if (revisionsOpenId === lessonId) {
      setRevisionsOpenId(null);
      return;
    }
    setRevisionsOpenId(lessonId);
    setRevisions(null);
    setRevisionsError(null);
    try {
      const data = await api<{ revisions: LessonRevision[] }>(`/api/learners/${encodeURIComponent(detail.learner.id)}/lessons/${encodeURIComponent(lessonId)}/revisions`);
      setRevisions(data.revisions);
    } catch (error) {
      setRevisionsError((error as Error).message);
    }
  };

  const saveEditLesson = async () => {
    if (!detail || !editingLessonId || !editDraft) return;
    const problems = validateLessonDraftFields(editDraft, editPaperSignature ? "paper" : "edit");
    if (problems.length) {
      setEditIssues({ source: "client", issues: problems, snapshot: editDraft });
      setEditAttempt((n) => n + 1);
      return;
    }
    setSaving(true);
    setEditStatus(null);
    try {
      const result = await api<{ lesson: Lesson; totals: Totals; progress: LearnerProgress; completion: CompletionSummary | null; invalidated: MilestoneInvalidation }>(
        `/api/learners/${encodeURIComponent(detail.learner.id)}/lessons/${encodeURIComponent(editingLessonId)}`,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(editPaperSignature ? { ...editDraft, adiSignature: "", learnerSignature: "", signatureStatus: editPaperSignature, reason: editReason } : { ...editDraft, reason: editReason }) },
      );
      // Editing a lesson can shift every subsequent lesson's cumulative
      // totals, so re-fetch the whole learner rather than patch one row.
      setRevisionsOpenId(null);
      setRevisions(null);
      await loadLearner(detail.learner.id);
      setInvalidation(result.invalidated);
      cancelEditLesson();
      const notice = invalidationNotice(result.invalidated);
      setStatus(notice ? { kind: "warn", text: `Lesson updated. ${notice}` } : { kind: "ok", text: "Lesson updated." });
    } catch (error) {
      setEditIssues({ source: "server", issues: [issueFromServerMessage((error as Error).message)], snapshot: editDraft });
      setEditAttempt((n) => n + 1);
    } finally {
      setSaving(false);
    }
  };

  // The ACTGDS Website links this learner's Integration ID by hand in its
  // own CRM (see docs/integrations/actgds-instructor-assistant-v1.md) — this
  // app never attempts to auto-match or look up a student itself.
  const copyIntegrationId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setStatus({ kind: "ok", text: "Integration ID copied." });
    } catch {
      setStatus({ kind: "error", text: `Could not copy automatically — Integration ID: ${id}` });
    }
  };

  const pickLearner = (id: string) => {
    setAddingLearner(false);
    setQuery("");
    void loadLearner(id);
  };

  const clearSelection = () => {
    selectedRef.current = "";
    setSelectedId("");
    setDetail(null);
    setDraft(null);
    cancelEditLesson();
    setInvalidation(null);
    resetArchiveUi();
  };

  const chooseView = (next: PickerView) => {
    setView(next);
    setQuery("");
    // The open learner only stays if they belong to the target view — never leave an active learner showing in Archived (or vice versa).
    const open = detail?.learner ?? [...learners, ...(archivedLearners ?? [])].find((l) => l.id === selectedId);
    if (selectionAfterViewChange(open, next, signedInInstructorId) === "clear") {
      clearSelection();
      setStatus(null);
    }
    if (next === "archived" && archivedLearners === null) {
      api<{ learners: Learner[] }>("/api/learners?status=archived")
        .then((data) => setArchivedLearners(data.learners))
        .catch((error: Error) => setStatus({ kind: "error", text: error.message }));
    }
  };

  // Archive is a reversible lifecycle flag, never a delete — lessons,
  // signatures, progress, PDF and the Integration ID all stay as they are.
  // Archiving goes through the inline panel (optional reason + note); restore is one tap, as before.
  const setLearnerArchived = async (archived: boolean) => {
    if (!detail) return;
    if (archived && !archiveDraft) return;
    const { id, fullName } = detail.learner;
    setSaving(true);
    setStatus(null);
    try {
      const body = archived && archiveDraft ? { archived, reason: archiveDraft.reason, note: archiveDraft.note } : { archived };
      const { learner } = await api<{ learner: Learner }>(`/api/learners/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      resetArchiveUi();
      if (archived) {
        setLearners((current) => current.filter((l) => l.id !== id));
        setArchivedLearners((current) => (current ? [...current.filter((l) => l.id !== id), learner].sort(byName) : current));
        if (storage.get(LAST_LEARNER_KEY) === id) storage.remove(LAST_LEARNER_KEY);
        clearSelection();
        setStatus({ kind: "ok", text: `${fullName} archived. Find them under "Archived" if you need them again.` });
      } else {
        setArchivedLearners((current) => (current ? current.filter((l) => l.id !== id) : current));
        setLearners((current) => [...current.filter((l) => l.id !== id), learner].sort(byName));
        setView(signedInInstructorId && learner.instructorId !== signedInInstructorId ? "all" : "mine");
        setDetail({ ...detail, learner });
        storage.set(LAST_LEARNER_KEY, id);
        setStatus({ kind: "ok", text: `${fullName} restored to the active learner list.` });
      }
    } catch (error) {
      setStatus({ kind: "error", text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  // Learner transfer (3c T1, design D1-D7): effective immediately, no accept step. Lessons keep their own instructor.
  const transferLearner = async () => {
    if (!detail || !transferDraft?.toId) return;
    const { id } = detail.learner;
    setSaving(true);
    setStatus(null);
    const swap = (learner: Learner) => setLearners((current) => current.map((l) => (l.id === learner.id ? learner : l)));
    try {
      const { learner } = await api<{ learner: Learner }>(`/api/learners/${encodeURIComponent(id)}/transfer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toInstructorId: transferDraft.toId, note: transferDraft.note }),
      });
      setTransferDraft(null);
      swap(learner);
      setDetail((current) => (current && current.learner.id === id ? { ...current, learner } : current));
      // The learner leaves this instructor's "My learners"; keep them open under "All" so the History line is visible.
      if (signedInInstructorId && learner.instructorId !== signedInInstructorId) setView("all");
      setStatus({ kind: "ok", text: `Transferred to ${learner.instructorName}.` });
    } catch (error) {
      setStatus({ kind: "error", text: (error as Error).message });
      // e.g. "already transferred by someone else": show the learner as it is now.
      try {
        const fresh = await api<Detail>(`/api/learners/${encodeURIComponent(id)}`);
        if (selectedRef.current === id) {
          swap(fresh.learner);
          setDetail((current) => (current && current.learner.id === id ? { ...current, learner: fresh.learner } : current));
          setTransferDraft(null);
        }
      } catch { /* the error above is already shown */ }
    } finally {
      setSaving(false);
    }
  };

  const markRecordsChecked = async () => {
    if (!detail) return;
    const { id } = detail.learner;
    setSaving(true);
    try {
      const { learner } = await api<{ learner: Learner }>(`/api/learners/${encodeURIComponent(id)}/transfer/checked`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      setLearners((current) => current.map((l) => (l.id === learner.id ? learner : l)));
      setDetail((current) => (current && current.learner.id === id ? { ...current, learner } : current));
    } catch (error) {
      setStatus({ kind: "error", text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const toggleArchiveHistory = async (open: boolean) => {
    if (!detail || !open || archiveHistory) return;
    setArchiveHistoryError(null);
    const forId = detail.learner.id;
    try {
      const data = await api<{ events: LearnerArchiveEvent[] }>(`/api/learners/${encodeURIComponent(forId)}/archive-history`);
      if (selectedRef.current === forId) setArchiveHistory(data.events); // a slow answer for a learner we have since left must not show under another
    } catch (error) {
      if (selectedRef.current === forId) setArchiveHistoryError((error as Error).message);
    }
  };

  const openAddLearner = () => {
    // Default to the signed-in instructor (Cloudflare Access); with no Access
    // identity (local dev), fall back to whoever this device last picked,
    // then the first active instructor — always still changeable via the dropdown.
    const defaultInstructorId = signedInInstructorId ?? storage.get(LAST_INSTRUCTOR_KEY) ?? instructors[0]?.id ?? "";
    setLearnerDraft({ ...emptyLearner, instructorId: instructors.some((i) => i.id === defaultInstructorId) ? defaultInstructorId : "" });
    setEditingLearner(false);
    setAddingLearner(true);
    setHoursOnTouched(false);
    setStatus(null);
  };

  // Live, derived values for the current lesson.
  const liveDuration = draft ? durationMinutes(draft.startTime, draft.finishTime) : null;
  const liveKm = draft ? distanceKm(parseOdometer(draft.startOdometer), parseOdometer(draft.finishOdometer)) : null;
  const startedMinutes = draft ? parseTime(draft.startTime) : null;
  const nowMinutes = parseTime(clock);
  const elapsed = startedMinutes !== null && nowMinutes !== null && nowMinutes >= startedMinutes ? nowMinutes - startedMinutes : null;
  const phase: "ready" | "running" | "ended" = !draft?.startTime ? "ready" : !draft.finishTime ? "running" : "ended";
  const lessonNo = nextLessonNo(totals);
  // Prior-instructor records (spec §12) are shown as compact cards, never as editable lessons.
  const history = splitPriorRecords(detail?.lessons ?? []);
  const shownSaveIssues = draft ? currentIssues(saveIssues, draft, "new") : [];
  const shownEditIssues = editDraft ? currentIssues(editIssues, editDraft, editPaperSignature ? "paper" : "edit") : [];

  // Only a licence-date/DOB edit refreshes an app-owned Eligibility; typing in Eligibility itself never auto-fills (so it can be cleared or rewritten).
  const learnerField = (key: keyof LearnerDraft, value: string) =>
    setLearnerDraft((current) => (isEligibilityDateKey(key) ? withAutoEligibility({ ...current, [key]: value }) : { ...current, [key]: value }));
  // Logged hours always come with an "as of" date (server rule D19): typing hours fills it with today (editable) unless the instructor set it by hand; clearing the hours clears it.
  const [hoursOnTouched, setHoursOnTouched] = useState(false);
  const loggedHoursField = (raw: string) =>
    setLearnerDraft((current) => {
      const digits = raw.replace(/\D/g, "").slice(0, 3);
      if (!digits) return { ...current, loggedHours: "", loggedHoursOn: "" };
      return { ...current, loggedHours: digits, loggedHoursOn: hoursOnTouched && current.loggedHoursOn ? current.loggedHoursOn : localNow().date };
    });

  // No Access identity (local dev) means "My learners" has no meaning.
  const views = availableViews(signedInInstructorId);
  const activeView: PickerView = views.includes(view) ? view : "all";
  const viewMembers = viewLearners(learners, archivedLearners ?? [], activeView, signedInInstructorId);
  // Dropdown = exactly this view's members; the open learner is never injected into a view they don't belong to.
  const selectOptions = viewMembers;
  const searchResults = filterLearners(viewMembers, { scope: "all", instructorId: signedInInstructorId, query });
  const mineCount = viewLearners(learners, [], "mine", signedInInstructorId).length;
  const viewLabel = (v: PickerView) =>
    v === "mine" ? `My learners (${mineCount})` : v === "all" ? `All (${learners.length})` : `Archived${archivedLearners ? ` (${archivedLearners.length})` : ""}`;
  const optionLabel = (l: Learner) => (activeView === "mine" ? l.fullName : `${l.fullName} · ${l.instructorName}`);
  const panel = detail ? learnerPanel({ archivedAt: detail.learner.archivedAt, completed: detail.progress.completed }) : "active";
  const archivedReason = detail ? archiveReasonText(detail.learner.archiveReason, detail.learner.archiveNote) : null;
  const openArchivePanel = () => { setTransferDraft(null); setArchiveDraft({ reason: "", note: "" }); };
  const archivePanel = detail && archiveDraft ? (
    <div className="lifecycle archive-panel" data-testid="archive-panel">
      <p><b>Archive {detail.learner.fullName}?</b> They will be hidden from the daily learner list. Lessons, signatures, progress and PDF are all kept, and you can restore them any time from &quot;Archived&quot;.</p>
      <label className="field"><span>Reason</span>
        <select aria-label="Archive reason" data-testid="archive-reason-select" value={archiveDraft.reason} onChange={(e) => setArchiveDraft({ ...archiveDraft, reason: e.target.value })}>
          <option value="">Choose a reason (optional)</option>
          {ARCHIVE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>
      <label className="field"><span>Note (optional)</span>
        <input aria-label="Archive note" data-testid="archive-note" value={archiveDraft.note} maxLength={MAX_ARCHIVE_NOTE_LENGTH} onChange={(e) => setArchiveDraft({ ...archiveDraft, note: e.target.value })} placeholder="e.g. moved to Sydney" autoComplete="off" />
      </label>
      <div className="archive-actions">
        <button type="button" className="btn ghost" disabled={saving} onClick={() => setArchiveDraft(null)} data-testid="archive-cancel">Cancel</button>
        <button type="button" className="btn primary" disabled={saving || phase !== "ready"} onClick={() => void setLearnerArchived(true)} data-testid="archive-confirm">Archive learner</button>
      </div>
    </div>
  ) : null;

  // Transfer (3c T1): the learner's own instructor, or anyone active when that instructor is inactive (not in the
  // active-only instructors list). Never for an archived learner (restore first). The server enforces the same rules.
  const homeInactive = Boolean(detail) && instructors.length > 0 && !instructors.some((i) => i.id === detail?.learner.instructorId);
  const canTransfer = Boolean(detail) && panel !== "archived" && (!signedInInstructorId || signedInInstructorId === detail?.learner.instructorId || homeInactive);
  const transferTargets = detail ? instructors.filter((i) => i.id !== detail.learner.instructorId) : [];
  const openTransferPanel = () => {
    setArchiveDraft(null);
    setTransferDraft({ toId: transferTargets.length === 1 ? transferTargets[0].id : "", note: "" });
  };
  const transferTargetName = transferTargets.find((i) => i.id === transferDraft?.toId)?.fullName ?? null;
  const transferPanel = detail && transferDraft ? (
    <div className="lifecycle transfer-panel" data-testid="transfer-panel">
      <p><b>Transfer {detail.learner.fullName}</b> to another instructor. Lessons already recorded stay with whoever recorded them.</p>
      {transferTargets.length ? (
        <fieldset className="transfer-choices">
          <legend>New instructor</legend>
          {transferTargets.map((i) => (
            <label key={i.id} className="transfer-choice">
              <input type="radio" name="transfer-to" value={i.id} checked={transferDraft.toId === i.id} onChange={() => setTransferDraft({ ...transferDraft, toId: i.id })} data-testid="transfer-choice" />
              <span>{i.fullName}</span>
            </label>
          ))}
        </fieldset>
      ) : <p className="meta">No other active instructor.</p>}
      <label className="field"><span>Note (optional)</span>
        <input aria-label="Transfer note" data-testid="transfer-note" value={transferDraft.note} maxLength={MAX_TRANSFER_NOTE_LENGTH} onChange={(e) => setTransferDraft({ ...transferDraft, note: e.target.value })} placeholder="Do not write personal details" autoComplete="off" />
      </label>
      <div className="archive-actions">
        <button type="button" className="btn ghost" disabled={saving} onClick={() => setTransferDraft(null)} data-testid="transfer-cancel">Cancel</button>
        <button type="button" className="btn primary" disabled={saving || !transferTargetName || phase !== "ready"} onClick={() => void transferLearner()} data-testid="transfer-confirm">
          {transferTargetName ? `Transfer to ${transferTargetName}` : "Choose an instructor"}
        </button>
      </div>
    </div>
  ) : null;
  // D7: the receiving instructor (or anyone, without an identity) sees the CoP 9.1 h / 9.2 e reminder until "Checked".
  const recordsCheck = detail ? pendingRecordsCheck(detail.learner) : null;
  const showRecordsCheck = Boolean(recordsCheck) && (!signedInInstructorId || signedInInstructorId === detail?.learner.instructorId);

  // Assessment-rule reminders (display only; lib/rules.ts, spec D1/D2). `clock` ticks every 15 s, so the lines stay current.
  void clock;
  const rulesNow = new Date();
  const lessonRefs = detail?.lessons ?? [];
  const licenceReminder: Reminder | null = detail ? learnerLicenceReminder(detail.learner, localNow(rulesNow).date) : null;
  // Learner intake D18: "Competency 23 from …" on the panel, learner stage only, not once CBT&A is completed.
  const eligibleFromLine: Reminder | null = detail && detail.learner.licenceStage === "learner" && panel !== "completed" ? finalDriveEligibleFromReminder(detail.learner, localNow(rulesNow).date) : null;
  const formEligibleFromLine: Reminder | null = addingLearner ? finalDriveEligibleFromReminder(draftEligibilityLearner(learnerDraft), localNow(rulesNow).date) : null;
  const panelReminders: Reminder[] = [];
  let showBookingLink = false;
  if (detail && phase === "ready" && panel === "active") {
    const gap = (review: typeof REVIEW_1_17 | typeof REVIEW_1_22) => reviewGapReminder({ review, progress: detail.progress, lessons: lessonRefs, moment: { kind: "now", now: rulesNow }, where: "panel" });
    const next = detail.progress.review1_17.status === "ready" ? gap(REVIEW_1_17) : detail.progress.review1_22.status === "ready" ? gap(REVIEW_1_22) : null;
    if (next) panelReminders.push(next);
    if (detail.progress.finalDrive23.status === "ready") {
      panelReminders.push(finalDriveEligibilityReminder(detail.learner, localNow(rulesNow).date));
      panelReminders.push(finalDrivePanelReminder(rulesNow));
      // R10 D5: the unfamiliar town centres (home district from the address), read before the lesson, never a verdict.
      panelReminders.push(routeSuggestionReminder(detail.learner.address));
      showBookingLink = true;
    }
  }
  // Learner management Phase 3a (lib/learner-checks.ts): display only, from the lists already loaded; never blocks a save.
  const canEditLearner = Boolean(detail) && (!signedInInstructorId || signedInInstructorId === detail?.learner.instructorId);
  const knownLearners = [...learners, ...(archivedLearners ?? [])];
  const learnerChecks: Reminder[] = [];
  if (detail) {
    const missing = missingPdfReminder(detail.learner, canEditLearner);
    if (missing) learnerChecks.push(missing);
    const duplicate = duplicateLicenceReminder(sameLicenceLearners(detail.learner.licenceNumber, detail.learner.id, knownLearners), detail.learner.instructorId, "panel");
    const archivedNote = duplicate ? null : archivedNotCheckedReminder(detail.learner.licenceNumber, archivedLearners !== null);
    if (duplicate) learnerChecks.push(duplicate);
    else if (archivedNote) learnerChecks.push(archivedNote);
  }
  const formOwnerId = editingLearner ? (detail?.learner.instructorId ?? null) : learnerDraft.instructorId || null;
  const formLicenceCheck: Reminder | null = addingLearner
    ? duplicateLicenceReminder(sameLicenceLearners(learnerDraft.licenceNumber, editingLearner ? editLearnerId : null, knownLearners), formOwnerId, "form") ??
      archivedNotCheckedReminder(learnerDraft.licenceNumber, archivedLearners !== null)
    : null;

  const formReminders: Reminder[] = [];
  if (detail && draft && phase !== "ready") {
    for (const review of [REVIEW_1_17, REVIEW_1_22] as const) {
      if (!draft.assessedIds.includes(review)) continue;
      const r = reviewGapReminder({ review, progress: detail.progress, lessons: lessonRefs, moment: { kind: "draft", date: draft.lessonDate, startTime: draft.startTime }, where: "form" });
      if (r) formReminders.push(r);
    }
    if (draft.assessedIds.includes(FINAL_DRIVE_23)) formReminders.push(finalDriveEligibilityReminder(detail.learner, draft.lessonDate), ...finalDriveFormReminders({ date: draft.lessonDate, startTime: draft.startTime, finishTime: draft.finishTime }));
  }
  // R10 (D3-D9): the route check lives in the draft's own location + comments (one generated line), parsed back on every render.
  const home = homeDistrict(detail?.learner.address);
  const routeState: RouteState | null = draft ? parseRouteComments(draft.comments).state : null;
  const editRouteState: RouteState | null = editDraft ? parseRouteComments(editDraft.comments).state : null;
  // Only the 23 transition touches location/comments (unticking 23 removes the app's own line); nothing is written when 23 is ticked.
  const withAssessed = (current: LessonDraft, ids: string[]): LessonDraft => {
    const { location, comments } = syncRouteWithAssessed({ location: current.location, comments: current.comments }, current.assessedIds.includes(FINAL_DRIVE_23), ids.includes(FINAL_DRIVE_23));
    return { ...current, assessedIds: ids, location, comments };
  };
  // Written only on an explicit tap in the group; all or nothing at the field limits (the group shows a grey line when refused).
  const withRoute = (current: LessonDraft, next: RouteState): LessonDraft => {
    const applied = applyRoute({ location: current.location, comments: current.comments }, next);
    return applied.ok ? { ...current, location: applied.location, comments: applied.comments } : current;
  };
  const routeFits = (current: LessonDraft, state: RouteState | null) => applyRoute({ location: current.location, comments: current.comments }, state ?? defaultRouteState(home)).ok;

  return (
    <main className="app">
      <header className="topbar">
        <img src="/icon.svg" width={32} height={32} alt="" />
        <div>
          <strong>ACTGDS Driver</strong>
          <small>CBT&amp;A Lesson Checklist</small>
        </div>
        {signedInAs ? (
          <div className="signed-in-as">
            <span>Signed in as {signedInAs}</span>
            <a href={logoutUrl} className="signout-link" data-testid="signout-link">Sign out</a>
          </div>
        ) : null}
      </header>

      <section className="card picker">
        {!ready ? (
          <p className="empty" data-testid="picker-loading" role="status">Loading your learners…</p>
        ) : (
          <>
        <div className="view-tabs" role="group" aria-label="Which learners to show">
          {views.map((v) => (
            <button key={v} type="button" className={`view-tab${activeView === v ? " active" : ""}`} aria-pressed={activeView === v} onClick={() => chooseView(v)}>
              {viewLabel(v)}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="learner-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={activeView === "archived" ? "Search archived learners…" : "Search learner name…"}
          aria-label="Search learner name"
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="search"
        />
        {query.trim() ? (
          <ul className="learner-results" aria-label="Matching learners">
            {searchResults.length ? (
              searchResults.map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => pickLearner(l.id)} data-testid="learner-result">
                    <span>{l.fullName}</span>
                    {activeView !== "mine" ? <small>{l.instructorName}</small> : null}
                  </button>
                </li>
              ))
            ) : (
              <li className="empty">No matching learners{activeView === "mine" ? ' — try "All"' : ""}.</li>
            )}
          </ul>
        ) : null}
        <div className="picker-row">
          <label className="field">
            <span>Learner</span>
            <select value={selectedId} onChange={(e) => pickLearner(e.target.value)} aria-label="Select learner">
              <option value="">{selectOptions.length ? "Select learner…" : activeView === "archived" ? "No archived learners" : "No learners here yet"}</option>
              {selectOptions.map((learner) => <option key={learner.id} value={learner.id}>{optionLabel(learner)}</option>)}
            </select>
          </label>
          <button type="button" className="btn ghost" onClick={() => (addingLearner ? closeLearnerForm() : openAddLearner())}>
            {addingLearner ? "Cancel" : "+ New"}
          </button>
        </div>
          </>
        )}
      </section>

      {status ? <p className={`status ${status.kind}`} role="status">{status.text}</p> : null}

      {addingLearner ? (
        <section className="card">
          <h2>{editingLearner ? "Edit learner" : "New learner"}</h2>
          <div className="grid">
            <label className="field full"><span>Student name *</span><input value={learnerDraft.fullName} onChange={(e) => learnerField("fullName", e.target.value)} autoComplete="off" /></label>
            <label className="field full"><span>Address</span><input value={learnerDraft.address} onChange={(e) => learnerField("address", e.target.value)} /></label>
            <label className="field"><span>Phone</span><input type="tel" inputMode="tel" value={learnerDraft.phone} onChange={(e) => learnerField("phone", e.target.value)} /></label>
            <label className="field"><span>DOB</span><input type="date" value={learnerDraft.dob} onChange={(e) => learnerField("dob", e.target.value)} /></label>
            <label className="field"><span>Licence number</span><input value={learnerDraft.licenceNumber} onChange={(e) => learnerField("licenceNumber", e.target.value)} autoCapitalize="characters" /></label>
            <label className="field"><span>Licence expiry</span><input type="date" value={learnerDraft.licenceExpiry} onChange={(e) => learnerField("licenceExpiry", e.target.value)} /></label>
            {formLicenceCheck ? <div className="full"><RulesReminders reminders={[formLicenceCheck]} testId="licence-duplicate" /></div> : null}
            <label className="field"><span>Eligibility</span><input value={learnerDraft.eligibility} onChange={(e) => learnerField("eligibility", e.target.value)} data-testid="learner-eligibility" />
              {showsAutoHint(learnerDraft.eligibility, draftEligibilityLearner(learnerDraft)) ? <small className="auto-hint" data-testid="eligibility-auto">auto: from the licence dates</small> : null}
            </label>
            <label className="field"><span>Manual / Auto</span>
              <select value={learnerDraft.transmission} onChange={(e) => learnerField("transmission", e.target.value)}>
                <option value="">—</option>
                <option value="auto">Auto</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label className="field full"><span>School / Work</span><input value={learnerDraft.schoolWork} onChange={(e) => learnerField("schoolWork", e.target.value)} /></label>
            <details className="full rules-group" key={editingLearner ? "edit" : "new"} data-testid="c23-group">
              <summary>Competency 23 eligibility</summary>
              <p className="hint-note">Optional. Only used for the Competency 23 reminder; nothing here blocks a save or goes to the website.</p>
              {formEligibleFromLine ? <RulesReminders reminders={[formEligibleFromLine]} testId="c23-from-form" /> : null}
              <div className="grid">
                <label className="field full"><span>Learner licence issue date</span>
                  <input type="date" value={learnerDraft.learnerLicenceIssuedOn} onChange={(e) => learnerField("learnerLicenceIssuedOn", e.target.value)} max={localNow().date} data-testid="c23-issued" />
                  <small>Leave empty to estimate it from the licence expiry (shown as estimated).</small>
                </label>
                <label className="field full"><span>First issue date (only if renewed)</span>
                  <input type="date" value={learnerDraft.learnerLicenceFirstIssuedOn} onChange={(e) => learnerField("learnerLicenceFirstIssuedOn", e.target.value)} max={localNow().date} data-testid="c23-first-issued" />
                </label>
                <label className="field full"><span>HPT passed on</span>
                  <input type="date" value={learnerDraft.hptPassedOn} onChange={(e) => learnerField("hptPassedOn", e.target.value)} max={localNow().date} data-testid="c23-hpt" />
                </label>
                <label className="field"><span>Logged hours (logbook)</span>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={learnerDraft.loggedHours} onChange={(e) => loggedHoursField(e.target.value)} placeholder="e.g. 82" data-testid="c23-hours" />
                </label>
                <label className="field"><span>Hours as of</span>
                  <input type="date" value={learnerDraft.loggedHoursOn} onChange={(e) => { setHoursOnTouched(true); learnerField("loggedHoursOn", e.target.value); }} max={localNow().date} data-testid="c23-hours-on" />
                </label>
              </div>
            </details>
            {editingLearner ? (
              <label className="field full"><span>Licence stage</span>
                <select value={learnerDraft.licenceStage} onChange={(e) => learnerField("licenceStage", e.target.value)} data-testid="edit-licence-stage">
                  <option value="learner">Learner</option>
                  <option value="p1">P1</option>
                  <option value="p2">P2</option>
                  <option value="full">Full</option>
                </select>
              </label>
            ) : (
              <label className="field full"><span>Instructor *</span>
                <select value={learnerDraft.instructorId} onChange={(e) => learnerField("instructorId", e.target.value)}>
                  <option value="">Select instructor…</option>
                  {instructors.map((i) => <option key={i.id} value={i.id}>{i.fullName}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="form-actions">
            <button type="button" className="btn primary block" disabled={saving} onClick={() => void (editingLearner ? saveLearnerEdit() : addLearner())} data-testid="save-learner">
              {saving ? "Saving…" : editingLearner ? "Save changes" : "Save learner"}
            </button>
            {editingLearner ? <button type="button" className="btn ghost block" disabled={saving} onClick={closeLearnerForm} data-testid="cancel-edit-learner">Cancel</button> : null}
          </div>
        </section>
      ) : null}

      {detail && draft && !addingLearner ? (
        <>
          <section className="card summary">
            <div className="summary-main">
              <small>{detail.learner.fullName}</small>
              <strong data-testid="lesson-no">{panel === "completed" ? "CBT&A Completed" : `Lesson #${lessonNo}`}</strong>
            </div>
            <dl className="totals">
              <div><dt>Hours so far</dt><dd data-testid="total-hours">{formatMinutes(totals.totalMinutes)} <em>({decimalHours(totals.totalMinutes)} h)</em></dd></div>
              <div><dt>Km so far</dt><dd data-testid="total-km">{totals.totalKm} km</dd></div>
            </dl>
            <p className="meta">
              {[detail.learner.transmission === "manual" ? "Manual" : detail.learner.transmission === "auto" ? "Auto" : null,
                detail.learner.licenceNumber ? `Licence ${detail.learner.licenceNumber}` : null,
                detail.learner.licenceExpiry ? `exp ${detail.learner.licenceExpiry}` : null,
                `ADI ${detail.learner.instructorName}`].filter(Boolean).join(" · ")}
            </p>
            {licenceReminder ? <RulesReminders reminders={[licenceReminder]} testId="licence-reminder" /> : null}
            {eligibleFromLine ? <RulesReminders reminders={[eligibleFromLine]} testId="c23-from" /> : null}
            <RulesReminders reminders={learnerChecks} testId="learner-checks" />
            {recordsCheck && showRecordsCheck ? (
              <div className="reminders" data-testid="transfer-check">
                <p className="reminder amber transfer-check" data-tone="amber">
                  <span>{recordsCheckText(recordsCheck.fromName)}</span>
                  <button type="button" className="btn ghost small" disabled={saving} onClick={() => void markRecordsChecked()} data-testid="transfer-checked">Checked</button>
                </p>
              </div>
            ) : null}
            <p className="meta integration-id">
              Integration ID: <code>{detail.learner.id}</code>
              <button type="button" className="link" onClick={() => void copyIntegrationId(detail.learner.id)}>Copy ID</button>
            </p>
            <ExportPdfButton key={detail.learner.id} learnerId={detail.learner.id} lessonCount={history.lessons.length} />
            {canEditLearner ? (
              <button type="button" className="btn ghost block edit-learner-btn" disabled={saving} onClick={openEditLearner} data-testid="edit-learner">Edit learner</button>
            ) : null}
            {canTransfer ? (
              transferDraft ? transferPanel : (
                <button type="button" className="link transfer-link" disabled={saving || phase !== "ready"} onClick={openTransferPanel} data-testid="transfer-open">
                  Transfer learner…
                </button>
              )
            ) : null}
            {panel === "archived" ? (
              <div className="lifecycle archived" data-testid="archived-banner">
                <p>
                  <b>Archived</b> {canberraDateTime(detail.learner.archivedAt)?.date}
                  {archivedReason ? <> — <span data-testid="archive-reason">{archivedReason}</span></> : null}
                </p>
                <p>Hidden from the daily learner list. Lessons, signatures, progress and PDF are kept.</p>
                <details key={detail.learner.id} className="archive-history" data-testid="archive-history" onToggle={(e) => void toggleArchiveHistory((e.currentTarget as HTMLDetailsElement).open)}>
                  <summary>History</summary>
                  {archiveHistoryError ? <p className="status error">{archiveHistoryError}</p> : !archiveHistory ? <p className="meta">Loading…</p> : archiveHistory.length === 0 ? (
                    <p className="meta" data-testid="archive-history-empty">No archive history recorded (archived before reasons were kept).</p>
                  ) : (
                    <ol>
                      {archiveHistory.map((event) => {
                        const why = event.action === "archived" ? archiveReasonText(event.reason, event.note) : null;
                        return (
                          <li key={event.id} data-testid="archive-history-item">
                            {canberraDateTime(event.at)?.date} {canberraDateTime(event.at)?.time} <b>{event.action === "archived" ? "Archived" : "Restored"}</b>
                            {why ? ` — ${why}` : ""}
                            {event.byName ? <small> · {event.byName}</small> : null}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </details>
                <button type="button" className="btn primary block" disabled={saving} onClick={() => void setLearnerArchived(false)}>Restore learner</button>
              </div>
            ) : panel === "active" ? (
              archiveDraft ? archivePanel : (
                <button type="button" className="link archive-link" disabled={saving || phase !== "ready"} onClick={openArchivePanel}>
                  Archive learner…
                </button>
              )
            ) : null}
          </section>

          <CompetencyProgressCard progress={detail.progress} completion={detail.completion} invalidated={invalidation} />

          {detail.lessons.length === 0 && panel === "active" ? (
            <PaperImportPanel key={detail.learner.id} learnerId={detail.learner.id} onImported={() => loadLearner(detail.learner.id)} />
          ) : null}

          {panel === "completed" ? (
            <section className="card lesson-completed" data-testid="cbta-completed-card">
              <h2>CBT&amp;A Completed</h2>
              <p className="meta">
                23 Final Drive achieved{detail.completion ? ` in Lesson #${detail.completion.completingLessonNo}` : ""}. No further CBT&amp;A lessons can be started for {detail.learner.fullName}.
              </p>
              <div className="lifecycle suggest" data-testid="archive-suggestion">
                <p>You can archive {detail.learner.fullName} to keep your daily list short — nothing is deleted and you can restore any time. Or just leave them active.</p>
                {archiveDraft ? archivePanel : <button type="button" className="btn ghost small" disabled={saving} onClick={openArchivePanel}>Archive learner…</button>}
              </div>
            </section>
          ) : null}

          {panel !== "active" ? null : (
          <section className="card lesson">
            {phase === "ready" ? (
              <>
                {panelReminders.length || showBookingLink ? (
                  <div className="start-reminders" data-testid="start-reminders">
                    <RulesReminders reminders={panelReminders} testId="panel-reminders" />
                    {showBookingLink ? <BookingLink /> : null}
                  </div>
                ) : null}
                <button type="button" className="btn huge go" onClick={startLesson}>Start Lesson</button>
              </>
            ) : (
              <div className="timebar">
                <div><small>Started</small><strong>{draft.startTime}</strong></div>
                <div>
                  <small>{phase === "running" ? "Elapsed" : "Duration"}</small>
                  <strong data-testid="duration">{phase === "running" ? (elapsed !== null ? formatMinutes(elapsed) : "—") : liveDuration !== null ? formatMinutes(liveDuration) : "—"}</strong>
                </div>
                <div><small>Finished</small><strong>{draft.finishTime || "—"}</strong></div>
              </div>
            )}
            {phase === "running" ? <button type="button" className="btn huge stop" onClick={endLesson}>End Lesson</button> : null}

            <div className="grid odo">
              <label className="field"><span>Start odometer (km)</span>
                <input id="lesson-field-start-odometer" type="text" inputMode="numeric" pattern="[0-9]*" value={draft.startOdometer} onChange={(e) => setField("startOdometer", e.target.value.replace(/\D/g, ""))} placeholder="e.g. 45210" />
              </label>
              <label className="field"><span>Finish odometer (km)</span>
                <input id="lesson-field-finish-odometer" ref={finishOdoRef} type="text" inputMode="numeric" pattern="[0-9]*" value={draft.finishOdometer} onChange={(e) => setField("finishOdometer", e.target.value.replace(/\D/g, ""))} disabled={phase !== "ended"} placeholder={phase === "ended" ? "Enter now" : "After End Lesson"} />
              </label>
            </div>
            {totals.lastFinishOdometer !== null && draft.startOdometer === String(totals.lastFinishOdometer) ? (
              <p className="hint">Start odometer carried from Lesson #{totals.lessonCount}.</p>
            ) : null}
            <p className="derived" data-testid="lesson-km">
              This lesson: <b>{liveDuration !== null ? formatMinutes(liveDuration) : "—"}</b> · <b>{liveKm !== null ? `${liveKm} km` : "—"}</b>
              {liveDuration !== null && liveKm !== null ? <> → total <b>{formatMinutes(totals.totalMinutes + liveDuration)}</b> · <b>{totals.totalKm + liveKm} km</b></> : null}
            </p>

            {phase !== "ready" ? (
              <>
                <div id="lesson-field-competency">
                <CompetencyPicker
                  progress={detail.progress}
                  taughtIds={draft.taughtIds}
                  assessedIds={draft.assessedIds}
                  achievedResults={draft.achievedResults}
                  onChangeTaught={(ids) => setDraft((current) => (current ? { ...current, taughtIds: ids } : current))}
                  onChangeAssessed={(ids) => setDraft((current) => (current ? withAssessed(current, ids) : current))}
                  onChangeAchieved={(results) => setDraft((current) => (current ? { ...current, achievedResults: results } : current))}
                />
                </div>
                <RulesReminders reminders={formReminders} testId="form-reminders" />
                {draft.assessedIds.includes(FINAL_DRIVE_23) ? (
                  <RouteCheckGroup state={routeState} home={home} achieved23={draft.achievedResults[FINAL_DRIVE_23] === "achieved"} fits={routeFits(draft, routeState)} inHistoryEdit={false} onChange={(next) => setDraft((current) => (current ? withRoute(current, next) : current))} testId="route-group" />
                ) : null}

                <div className="grid">
                  <label className="field full"><span>Location</span><input value={draft.location} onChange={(e) => setField("location", e.target.value)} placeholder="Belconnen, Gungahlin…" /></label>
                  <label className="field full"><span>Comments</span><textarea rows={2} value={draft.comments} onChange={(e) => setField("comments", e.target.value)} /></label>
                </div>

                <details className="edit-times">
                  <summary>Edit date / times</summary>
                  <div className="grid">
                    <label className="field full"><span>Date</span><input id="lesson-field-date" type="date" value={draft.lessonDate} onChange={(e) => setField("lessonDate", e.target.value)} /></label>
                    <label className="field"><span>Start time</span><input id="lesson-field-times" type="time" value={draft.startTime} onChange={(e) => setField("startTime", e.target.value)} /></label>
                    <label className="field"><span>Finish time</span><input type="time" value={draft.finishTime} onChange={(e) => setField("finishTime", e.target.value)} /></label>
                  </div>
                </details>

                <div id="lesson-field-adi-signature"><SignaturePad label="ADI signature" value={draft.adiSignature} onChange={(value) => setField("adiSignature", value)} /></div>
                <div id="lesson-field-learner-signature"><SignaturePad label="Learner signature" value={draft.learnerSignature} onChange={(value) => setField("learnerSignature", value)} /></div>

                <SaveErrorSummary issues={shownSaveIssues} prefix="lesson" attempt={saveAttempt} />
                <button type="button" className="btn huge save" disabled={saving || phase !== "ended"} onClick={() => void saveLesson()}>
                  {saving ? "Saving…" : phase !== "ended" ? "Save (tap End Lesson first)" : `Save Lesson #${lessonNo}`}
                </button>
                <button type="button" className="link danger" onClick={discardLesson}>Discard this lesson</button>
              </>
            ) : null}
          </section>
          )}

          <section className="card history">
            <h2>History</h2>
            <p className="meta" data-testid="history-learner">{detail.learner.fullName}</p>
            {!history.lessons.length ? <p className="empty">No lessons yet.</p> : null}
            {history.lessons.length || detail.learner.transfers.length ? (
              <ol>
                {withTransferDividers(history.lessons, detail.learner.transfers).map((item) => {
                  if (item.kind === "transfer") return <li key={item.event.id} className="h-transfer" data-testid="history-transfer">{transferLine(item.event)}</li>;
                  const lesson = item.lesson;
                  return editingLessonId === lesson.id ? (
                    <li key={lesson.id} className="h-editing">
                      {editLoading || !editDraft || !editProgress ? (
                        <p className="empty">Loading…</p>
                      ) : (
                        <>
                          <h3>Editing Lesson #{lesson.lessonNo}</h3>
                          {editStatus ? <p className="status error">{editStatus}</p> : null}
                          <div className="grid">
                            <label className="field"><span>Date</span><input id="edit-field-date" type="date" value={editDraft.lessonDate} onChange={(e) => setEditFieldValue((d) => ({ ...d, lessonDate: e.target.value }))} /></label>
                            <label className="field"><span>Location</span><input value={editDraft.location} onChange={(e) => setEditFieldValue((d) => ({ ...d, location: e.target.value }))} /></label>
                            <label className="field"><span>Start time{editPaperSignature ? " (optional)" : ""}</span><input id="edit-field-times" type="time" value={editDraft.startTime} onChange={(e) => setEditFieldValue((d) => ({ ...d, startTime: e.target.value }))} /></label>
                            <label className="field"><span>Finish time{editPaperSignature ? " (optional)" : ""}</span><input type="time" value={editDraft.finishTime} onChange={(e) => setEditFieldValue((d) => ({ ...d, finishTime: e.target.value }))} /></label>
                            <label className="field"><span>Start odometer (km){editPaperSignature ? " (optional)" : ""}</span><input id="edit-field-start-odometer" type="text" inputMode="numeric" pattern="[0-9]*" value={editDraft.startOdometer} onChange={(e) => setEditFieldValue((d) => ({ ...d, startOdometer: e.target.value.replace(/\D/g, "") }))} /></label>
                            <label className="field"><span>Finish odometer (km){editPaperSignature ? " (optional)" : ""}</span><input id="edit-field-finish-odometer" type="text" inputMode="numeric" pattern="[0-9]*" value={editDraft.finishOdometer} onChange={(e) => setEditFieldValue((d) => ({ ...d, finishOdometer: e.target.value.replace(/\D/g, "") }))} /></label>
                          </div>
                          {editPaperSignature ? <p className="meta paper-hint">Leave both blank if not on the paper record</p> : null}
                          <p className="derived">
                            Recalculated: <b>{(() => { const m = durationMinutes(editDraft.startTime, editDraft.finishTime); return m !== null ? formatMinutes(m) : "—"; })()}</b> ·{" "}
                            <b>{(() => { const k = distanceKm(parseOdometer(editDraft.startOdometer), parseOdometer(editDraft.finishOdometer)); return k !== null ? `${k} km` : "—"; })()}</b>
                            {" "}(lesson number, duration, distance and cumulative totals are always recalculated, never typed)
                          </p>

                          <div id="edit-field-competency">
                          <CompetencyPicker
                            progress={editProgress}
                            gateProgress={editGateProgress ?? undefined}
                            taughtIds={editDraft.taughtIds}
                            assessedIds={editDraft.assessedIds}
                            achievedResults={editDraft.achievedResults}
                            onChangeTaught={(ids) => setEditFieldValue((d) => ({ ...d, taughtIds: ids }))}
                            onChangeAssessed={(ids) => setEditFieldValue((d) => withAssessed(d, ids))}
                            onChangeAchieved={(results) => setEditFieldValue((d) => ({ ...d, achievedResults: results }))}
                          />
                          </div>
                          {editDraft.assessedIds.includes(FINAL_DRIVE_23) ? (
                            <RouteCheckGroup state={editRouteState} home={home} achieved23={editDraft.achievedResults[FINAL_DRIVE_23] === "achieved"} fits={routeFits(editDraft, editRouteState)} inHistoryEdit onChange={(next) => setEditFieldValue((d) => withRoute(d, next))} testId="edit-route-group" />
                          ) : null}

                          <label className="field full"><span>Comments</span><textarea rows={2} value={editDraft.comments} onChange={(e) => setEditFieldValue((d) => ({ ...d, comments: e.target.value }))} /></label>

                          {editPaperSignature ? (
                            <label className="field full"><span>Signature</span>
                              <select data-testid="paper-signature-status" value={editPaperSignature} onChange={(e) => setEditPaperSignature(e.target.value as SignatureStatus)}>
                                <option value="on_paper">Signed on paper</option>
                                <option value="unsigned">Not signed</option>
                              </select>
                            </label>
                          ) : (
                            <>
                              {editOriginal && contentChanged(editOriginal, editDraft) ? (
                                <p className="hint danger">Content changed — both signatures were cleared. Please redraw both before saving.</p>
                              ) : null}
                              <div id="edit-field-adi-signature"><SignaturePad label="ADI signature" value={editDraft.adiSignature} onChange={(value) => setEditFieldValue((d) => ({ ...d, adiSignature: value }))} /></div>
                              <div id="edit-field-learner-signature"><SignaturePad label="Learner signature" value={editDraft.learnerSignature} onChange={(value) => setEditFieldValue((d) => ({ ...d, learnerSignature: value }))} /></div>

                            </>
                          )}

                          <label className="field full"><span>Reason for this change (optional)</span>
                            <input data-testid="edit-reason" value={editReason} maxLength={200} onChange={(e) => setEditReason(e.target.value)} placeholder="e.g. wrong odometer reading" autoComplete="off" />
                            <small className="hint">{editReason.length}/200 · kept with the previous version, like initialling a correction on paper</small>
                          </label>

                          <SaveErrorSummary issues={shownEditIssues} prefix="edit" attempt={editAttempt} />
                          <button type="button" className="btn huge save" disabled={saving} onClick={() => void saveEditLesson()}>
                            {saving ? "Saving…" : "Save changes"}
                          </button>
                          <button type="button" className="link" onClick={cancelEditLesson}>Cancel</button>
                        </>
                      )}
                    </li>
                  ) : (
                    <li key={lesson.id} data-testid="history-row">
                      <div className="h-top">
                        <span className="h-no">#{lesson.lessonNo}</span>
                        {lesson.recordSource === "paper_import" ? <span className="h-paper" data-testid="paper-badge">Paper record</span> : null}
                        <span>{lesson.lessonDate} · {lesson.startTime ?? "—"}–{lesson.finishTime ?? "—"}</span>
                        {signedInInstructorId && lesson.instructorId !== signedInInstructorId ? (
                          <span className="h-readonly" data-testid="history-readonly">Recorded by {instructors.find((i) => i.id === lesson.instructorId)?.fullName ?? "another instructor"}</span>
                        ) : (
                          <button type="button" className="link h-edit" onClick={() => void startEditLesson(lesson.id)}>Edit</button>
                        )}
                      </div>
                      <div className="h-nums">
                        <span>{lesson.durationMinutes === null ? "—" : formatMinutes(lesson.durationMinutes)} · {lesson.distanceKm === null ? "—" : lesson.distanceKm} km</span>
                        <span>Total {formatMinutes(lesson.cumulativeMinutes)} · {lesson.cumulativeKm} km</span>
                      </div>
                      <div className="h-odo">Odo {lesson.startOdometer ?? "—"} → {lesson.finishOdometer ?? "—"}{lesson.location ? ` · ${lesson.location}` : ""}</div>
                      {lesson.taught ? <p><b>Taught:</b> {lesson.taught}</p> : null}
                      {lesson.competenciesAssessed ? <p><b>Assessed:</b> {lesson.competenciesAssessed}</p> : null}
                      {lesson.achieved ? <p><b>Achieved:</b> {lesson.achieved}</p> : null}
                      {lesson.comments ? <p><b>Comments:</b> {lesson.comments}</p> : null}
                      {lesson.revisionCount > 0 ? (
                        <p className="h-revisions">
                          <button type="button" className="link" data-testid="revisions-toggle" aria-expanded={revisionsOpenId === lesson.id} onClick={() => void toggleRevisions(lesson.id)}>
                            Edited {lesson.revisionCount} {lesson.revisionCount === 1 ? "time" : "times"}
                          </button>
                        </p>
                      ) : null}
                      {revisionsOpenId === lesson.id ? (
                        <div className="revisions" data-testid="revisions-list">
                          {revisionsError ? <p className="status error">{revisionsError}</p> : !revisions ? <p className="empty">Loading…</p> : (
                            <ol>
                              {revisions.map((revision, index) => {
                                const next = index + 1 < revisions.length ? revisions[index + 1].snapshot : snapshotOfLesson(lesson);
                                const changes = revisionChanges(revision.snapshot, next);
                                return (
                                  <li key={revision.id} data-testid="revision-item">
                                    <strong>Version {revision.revisionNo}</strong>
                                    <small> replaced {revision.editedAt.slice(0, 16).replace("T", " ")} UTC{revision.editedByName ? ` by ${revision.editedByName}` : ""}</small>
                                    {revision.reason ? <p className="rev-reason">Reason: {revision.reason}</p> : null}
                                    {changes.length ? (
                                      <ul>
                                        {changes.map((change) => (
                                          <li key={change.field}><span>{change.label}: </span><del data-testid="revision-struck">{change.before}</del> → <b>{change.after}</b></li>
                                        ))}
                                      </ul>
                                    ) : <p className="meta" data-testid="revision-no-change">No recorded value changed.</p>}
                                  </li>
                                );
                              })}
                            </ol>
                          )}
                        </div>
                      ) : null}
                      {lesson.updatedAt ? (
                        <p className="h-edited">
                          {lesson.editedBeforeRevisionHistory ? <span data-testid="edited-before-history">Edited (before revision history) </span> : "Edited "}{lesson.updatedAt}
                          {lesson.updatedByInstructorName ? ` · Last edited by ${lesson.updatedByInstructorName}` : ""}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
            {/* Newest first: prior-instructor records come before lesson #1, so they sit below it. */}
            {history.prior.length ? (
              <ul className="h-prior-list">
                {[...history.prior].reverse().map((record) => (
                  <li key={record.id} className="h-prior" data-testid="prior-record">{priorRecordLine(record)}</li>
                ))}
              </ul>
            ) : null}
          </section>
        </>
      ) : null}

      <footer className="foot">ACT Golden Driving School · Internal instructor tool</footer>
    </main>
  );
}
