"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decimalHours,
  distanceKm,
  durationMinutes,
  EMPTY_TOTALS,
  formatMinutes,
  localNow,
  nextLessonNo,
  parseOdometer,
  parseTime,
  type Totals,
} from "@/lib/calc.ts";
import { FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22, type AssessmentResult, type LearnerProgress, type MilestoneInvalidation } from "@/lib/competency.ts";
import { accessLogoutUrl } from "@/lib/access-logout.ts";
import { filterLearners } from "@/lib/learner-filter.ts";
import { currentIssues, issueFromServerMessage, validateLessonDraftFields, type IssueState } from "@/lib/lesson-form-errors.ts";
import { availableViews, initialSelection, learnerPanel, selectionAfterViewChange, viewLearners, type PickerView } from "@/lib/learner-picker.ts";
import { priorRecordLine, splitPriorRecords } from "@/lib/prior-record.ts";
import { revisionChanges, snapshotOfLesson } from "@/lib/revision-diff.ts";
import type { CompletionSummary, Instructor, Learner, Lesson, LessonRevision, SignatureStatus } from "@/lib/types.ts";
import CompetencyPicker from "./competency-picker.tsx";
import CompetencyProgressCard from "./competency-progress.tsx";
import ExportPdfButton from "./export-pdf-button.tsx";
import SaveErrorSummary from "./save-error-summary.tsx";
import PaperImportPanel from "./paper-import-panel.tsx";
import SignaturePad from "./signature-pad.tsx";
import { BookingLink, RulesReminders } from "./rules-reminders.tsx";
import { finalDriveFormReminders, finalDrivePanelReminder, learnerLicenceReminder, reviewGapReminder, type Reminder } from "@/lib/rules.ts";

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

const emptyLearner: LearnerDraft = {
  fullName: "",
  address: "",
  phone: "",
  dob: "",
  licenceNumber: "",
  licenceExpiry: "",
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
  const [learnerDraft, setLearnerDraft] = useState<LearnerDraft>(emptyLearner);
  const [status, setStatus] = useState<{ kind: "info" | "error" | "ok"; text: string } | null>(null);
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
        body: JSON.stringify(learnerDraft),
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
    setLearnerDraft({
      fullName: l.fullName, address: l.address ?? "", phone: l.phone ?? "", dob: l.dob ?? "", licenceNumber: l.licenceNumber ?? "",
      licenceExpiry: l.licenceExpiry ?? "", eligibility: l.eligibility ?? "", transmission: l.transmission ?? "", schoolWork: l.schoolWork ?? "",
      licenceStage: l.licenceStage, instructorId: l.instructorId,
    });
    setEditingLearner(true);
    setAddingLearner(true);
    setStatus(null);
  };

  const closeLearnerForm = () => {
    setAddingLearner(false);
    setEditingLearner(false);
  };

  const saveLearnerEdit = async () => {
    if (!detail) return;
    setSaving(true);
    setStatus(null);
    try {
      const { instructorId: _owner, ...fields } = learnerDraft;
      void _owner;
      const result = await api<{ learner: Learner; changed: boolean; message?: string }>(`/api/learners/${encodeURIComponent(detail.learner.id)}`, {
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
      setStatus({ kind: "ok", text: "Lesson updated." });
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
  const setLearnerArchived = async (archived: boolean) => {
    if (!detail) return;
    const { id, fullName } = detail.learner;
    if (archived && !window.confirm(`Archive ${fullName}?\n\nThey will be hidden from the daily learner list. Lessons, signatures, progress and PDF are all kept, and you can restore them any time from "Archived".`)) return;
    setSaving(true);
    setStatus(null);
    try {
      const { learner } = await api<{ learner: Learner }>(`/api/learners/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived }),
      });
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

  const openAddLearner = () => {
    // Default to the signed-in instructor (Cloudflare Access); with no Access
    // identity (local dev), fall back to whoever this device last picked,
    // then the first active instructor — always still changeable via the dropdown.
    const defaultInstructorId = signedInInstructorId ?? storage.get(LAST_INSTRUCTOR_KEY) ?? instructors[0]?.id ?? "";
    setLearnerDraft({ ...emptyLearner, instructorId: instructors.some((i) => i.id === defaultInstructorId) ? defaultInstructorId : "" });
    setEditingLearner(false);
    setAddingLearner(true);
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

  const learnerField = (key: keyof LearnerDraft, value: string) => setLearnerDraft((current) => ({ ...current, [key]: value }));

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

  // Assessment-rule reminders (display only; lib/rules.ts, spec D1/D2). `clock` ticks every 15 s, so the lines stay current.
  void clock;
  const rulesNow = new Date();
  const lessonRefs = detail?.lessons ?? [];
  const licenceReminder: Reminder | null = detail ? learnerLicenceReminder(detail.learner, localNow(rulesNow).date) : null;
  const panelReminders: Reminder[] = [];
  let showBookingLink = false;
  if (detail && phase === "ready" && panel === "active") {
    const gap = (review: typeof REVIEW_1_17 | typeof REVIEW_1_22) => reviewGapReminder({ review, progress: detail.progress, lessons: lessonRefs, moment: { kind: "now", now: rulesNow }, where: "panel" });
    const next = detail.progress.review1_17.status === "ready" ? gap(REVIEW_1_17) : detail.progress.review1_22.status === "ready" ? gap(REVIEW_1_22) : null;
    if (next) panelReminders.push(next);
    if (detail.progress.finalDrive23.status === "ready") {
      panelReminders.push(finalDrivePanelReminder(rulesNow));
      showBookingLink = true;
    }
  }
  const formReminders: Reminder[] = [];
  if (detail && draft && phase !== "ready") {
    for (const review of [REVIEW_1_17, REVIEW_1_22] as const) {
      if (!draft.assessedIds.includes(review)) continue;
      const r = reviewGapReminder({ review, progress: detail.progress, lessons: lessonRefs, moment: { kind: "draft", date: draft.lessonDate, startTime: draft.startTime }, where: "form" });
      if (r) formReminders.push(r);
    }
    if (draft.assessedIds.includes(FINAL_DRIVE_23)) formReminders.push(...finalDriveFormReminders({ date: draft.lessonDate, startTime: draft.startTime, finishTime: draft.finishTime }));
  }

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
            <label className="field"><span>Eligibility</span><input value={learnerDraft.eligibility} onChange={(e) => learnerField("eligibility", e.target.value)} /></label>
            <label className="field"><span>Manual / Auto</span>
              <select value={learnerDraft.transmission} onChange={(e) => learnerField("transmission", e.target.value)}>
                <option value="">—</option>
                <option value="auto">Auto</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label className="field full"><span>School / Work</span><input value={learnerDraft.schoolWork} onChange={(e) => learnerField("schoolWork", e.target.value)} /></label>
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
            <p className="meta integration-id">
              Integration ID: <code>{detail.learner.id}</code>
              <button type="button" className="link" onClick={() => void copyIntegrationId(detail.learner.id)}>Copy ID</button>
            </p>
            <ExportPdfButton key={detail.learner.id} learnerId={detail.learner.id} lessonCount={history.lessons.length} />
            {!signedInInstructorId || signedInInstructorId === detail.learner.instructorId ? (
              <button type="button" className="btn ghost block edit-learner-btn" disabled={saving} onClick={openEditLearner} data-testid="edit-learner">Edit learner</button>
            ) : null}
            {panel === "archived" ? (
              <div className="lifecycle archived" data-testid="archived-banner">
                <p><b>Archived</b> {detail.learner.archivedAt?.slice(0, 10)} — hidden from the daily learner list. Lessons, signatures, progress and PDF are kept.</p>
                <button type="button" className="btn primary block" disabled={saving} onClick={() => void setLearnerArchived(false)}>Restore learner</button>
              </div>
            ) : panel === "active" ? (
              <button type="button" className="link archive-link" disabled={saving || phase !== "ready"} onClick={() => void setLearnerArchived(true)}>
                Archive learner…
              </button>
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
                <button type="button" className="btn ghost small" disabled={saving} onClick={() => void setLearnerArchived(true)}>Archive learner…</button>
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
                  onChangeAssessed={(ids) => setDraft((current) => (current ? { ...current, assessedIds: ids } : current))}
                  onChangeAchieved={(results) => setDraft((current) => (current ? { ...current, achievedResults: results } : current))}
                />
                </div>
                <RulesReminders reminders={formReminders} testId="form-reminders" />

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
            {!history.lessons.length ? <p className="empty">No lessons yet.</p> : (
              <ol>
                {history.lessons.map((lesson) =>
                  editingLessonId === lesson.id ? (
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
                            onChangeAssessed={(ids) => setEditFieldValue((d) => ({ ...d, assessedIds: ids }))}
                            onChangeAchieved={(results) => setEditFieldValue((d) => ({ ...d, achievedResults: results }))}
                          />
                          </div>

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
                  ),
                )}
              </ol>
            )}
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
