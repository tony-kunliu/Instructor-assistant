"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { CORE_COMPETENCY_IDS, FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22, invalidationNotice, type AssessmentResult, type LearnerProgress, type MilestoneInvalidation } from "@/lib/competency.ts";
import { cardMeta, cardReminders, collapsedCards, emptySummary, gateChips, glance, initials, lastLessonLine, listCollapsed, optionLabel, summaryFromProgress, type LearnerListSummary } from "@/lib/learner-card.ts";
import { derivedStats, learnerHeaderMeta, lessonDateLine, lessonPhase, odometerCarriedNote, showsSaveBar } from "@/lib/lesson-view.ts";
import { accessLogoutUrl } from "@/lib/access-logout.ts";
import { ARCHIVE_REASONS, archiveReasonText, MAX_ARCHIVE_NOTE_LENGTH } from "@/lib/archive-reasons.ts";
import { filterLearners } from "@/lib/learner-filter.ts";
import { MAX_TRANSFER_NOTE_LENGTH, pendingRecordsCheck, recordsCheckText, transferLine, withTransferDividers } from "@/lib/learner-transfer.ts";
import { archivedNotCheckedReminder, duplicateLicenceReminder, missingPdfReminder, sameLicenceLearners } from "@/lib/learner-checks.ts";
import { currentIssues, issueFromServerMessage, validateLessonDraftFields, type IssueState } from "@/lib/lesson-form-errors.ts";
import { availableViews, initialSelection, learnerPanel, selectionAfterViewChange, viewLearners, type PickerView } from "@/lib/learner-picker.ts";
import { priorRecordLine, splitPriorRecords } from "@/lib/prior-record.ts";
import { revisionChanges, snapshotOfLesson } from "@/lib/revision-diff.ts";
import type { CompletionSummary, Instructor, Learner, LearnerArchiveEvent, Lesson, LessonRevision, SignatureStatus, UnsignedLessonItem } from "@/lib/types.ts";
import CompetencyPicker from "./competency-picker.tsx";
import CompetencyProgressCard from "./competency-progress.tsx";
import ExportPdfButton from "./export-pdf-button.tsx";
import SaveErrorSummary from "./save-error-summary.tsx";
import PaperImportPanel from "./paper-import-panel.tsx";
import SignaturePad from "./signature-pad.tsx";
import SavedSignature from "./saved-signature.tsx";
import SignQueue from "./sign-queue.tsx";
import { BookingLink, RulesReminders } from "./rules-reminders.tsx";
import { finalDriveEligibilityReminder, finalDriveEligibleFromReminder, finalDriveFormReminders, finalDrivePanelReminder, learnerLicenceReminder, otherLicenceDataReminder, reviewGapReminder, type EligibilityLearner, type Reminder } from "@/lib/rules.ts";
import { COUNTRIES, holdsOtherLicence, INTERSTATE_PLACES, MAX_OTHER_NUMBER_LENGTH, MAX_OTHER_PLACE_LENGTH, OTHER_LICENCE_CLASS_LABELS, OTHER_LICENCE_CLASSES, OTHER_LICENCE_HINT, OTHER_LICENCE_KIND_LABELS, OTHER_LICENCE_KINDS } from "@/lib/other-licence.ts";
import { autoFillEligibility, ELIGIBILITY_DATE_KEYS, eligibilityAtSave, showsAutoHint } from "@/lib/c23-eligibility.ts";
import { applyRoute, homeDistrict, parseRouteComments, routeFits, routeSuggestionReminder, syncRouteWithAssessed, type RouteState } from "@/lib/route-check.ts";
import RouteCheckGroup from "./route-check.tsx";
import { GNAF_ATTRIBUTION, partsAfterEdit, type AddressSuggestion } from "@/lib/address-suggest.ts";
import AddressInput from "./address-input.tsx";
import { addressPartChips, formSubline, moreLockedMessage, moreSection, nameIssue, saveLabel } from "@/lib/learner-form-view.ts";
import { instructorLabel } from "@/lib/instructor-label.ts";
import { matchLearnersByName, parseAssistantDraft } from "@/lib/assistant-draft.ts";
import { requestErrorMessage, trialBanner } from "@/lib/saas/trial-banner.ts";
import ThemeToggle from "./theme-switch.tsx";

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
  /** Picked-suggestion parts (intake D7); "" when none. Cleared by the form once the text no longer holds the suburb as a whole word. */
  addressSuburb: string;
  addressState: string;
  addressPostcode: string;
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
  /** Overseas / interstate licence group (migration 0013, intake P3 D11); "" = not recorded. Details cleared when the kind is not interstate / overseas. */
  otherLicenceKind: string;
  otherLicencePlace: string;
  otherLicenceNumber: string;
  otherLicenceClass: string;
  otherLicenceIssuedOn: string;
  otherLicenceExpiresOn: string;
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

/** The open learner's card data from the detail just loaded (same totals/progress the panel shows), so the card never lags a save. */
function summaryFromDetail(detail: Detail): LearnerListSummary {
  const lastLessonDate = detail.lessons.filter((l) => l.lessonNo > 0).reduce<string | null>((latest, l) => (latest === null || l.lessonDate > latest ? l.lessonDate : latest), null);
  return summaryFromProgress(detail.progress, detail.totals, lastLessonDate);
}

/** The form's Competency 23 inputs as the rules read them ("" = not recorded). */
function draftEligibilityLearner(d: LearnerDraft): EligibilityLearner {
  const date = (v: string) => v || null;
  return {
    dob: date(d.dob), licenceExpiry: date(d.licenceExpiry), learnerLicenceIssuedOn: date(d.learnerLicenceIssuedOn),
    learnerLicenceFirstIssuedOn: date(d.learnerLicenceFirstIssuedOn), hptPassedOn: date(d.hptPassedOn),
    loggedHours: /^\d+$/.test(d.loggedHours) ? Number(d.loggedHours) : null, loggedHoursOn: date(d.loggedHoursOn),
    otherLicenceKind: date(d.otherLicenceKind), otherLicenceClass: date(d.otherLicenceClass), otherLicenceIssuedOn: date(d.otherLicenceIssuedOn), otherLicencePlace: date(d.otherLicencePlace.trim()),
  };
}

/** D12: the answer "No" (or not recorded) clears the detail fields; switching interstate ↔ overseas clears the place (a state is not a country). */
function withOtherLicenceKind(d: LearnerDraft, kind: string): LearnerDraft {
  if (!holdsOtherLicence(kind)) return { ...d, otherLicenceKind: kind, otherLicencePlace: "", otherLicenceNumber: "", otherLicenceClass: "", otherLicenceIssuedOn: "", otherLicenceExpiresOn: "" };
  return { ...d, otherLicenceKind: kind, otherLicencePlace: kind === d.otherLicenceKind ? d.otherLicencePlace : "" };
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
  addressSuburb: "",
  addressState: "",
  addressPostcode: "",
  phone: "",
  dob: "",
  licenceNumber: "",
  licenceExpiry: "",
  learnerLicenceIssuedOn: "",
  learnerLicenceFirstIssuedOn: "",
  hptPassedOn: "",
  loggedHours: "",
  loggedHoursOn: "",
  otherLicenceKind: "",
  otherLicencePlace: "",
  otherLicenceNumber: "",
  otherLicenceClass: "",
  otherLicenceIssuedOn: "",
  otherLicenceExpiresOn: "",
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
  // A 402 trial_expired (SaaS edition only, never sent in private) reads as a friendly sentence, never the raw code.
  if (!response.ok) throw new Error(requestErrorMessage(response.status, data));
  return data as T;
}

/** `mode` comes from the server page (app/page.tsx) so the SaaS edition never flashes the private edition's header; omitted = private. */
export default function DriverApp({ mode = "private" }: { mode?: "private" | "saas" }) {
  const [learners, setLearners] = useState<Learner[]>([]);
  // Per-learner card data (lessons, hours, competencies, gates) from GET /api/learners; refreshed from the detail of the open learner.
  const [summaries, setSummaries] = useState<Record<string, LearnerListSummary>>({});
  // With a learner open, the list shows only their card until "Show all learners" (or a search / view change) expands it.
  const [listExpanded, setListExpanded] = useState(false);
  // "Show all learners" moves keyboard focus to the open learner's card (or the first card) once the list has expanded.
  const focusCardAfterExpand = useRef(false);
  // The archived learners' card data is fetched only when the Archived tab is opened (the background archived fetch for
  // the duplicate-licence check carries no summaries, so D1 does not aggregate every archived learner on each page load).
  const [archivedSummariesLoaded, setArchivedSummariesLoaded] = useState(false);
  // Set when that fetch failed: the archived cards show without details and offer a retry (never "Loading…" forever).
  const [archivedSummariesError, setArchivedSummariesError] = useState<string | null>(null);
  const loadArchivedSummaries = useCallback(() => {
    setArchivedSummariesError(null);
    api<{ learners: Learner[]; summaries: Record<string, LearnerListSummary> }>("/api/learners?status=archived")
      .then((data) => {
        setArchivedLearners(data.learners);
        // The server's figures replace whatever this device held (an archived learner opened since derives the same data from its detail).
        setSummaries((current) => ({ ...current, ...data.summaries }));
        setArchivedSummariesLoaded(true);
      })
      .catch((error: Error) => setArchivedSummariesError(error.message));
  }, []);
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
  // Draft learners (Tony 2026-10-22): the "what to check" notes kept with a draft, and whether the open form edits one.
  const [draftNotesText, setDraftNotesText] = useState("");
  const [status, setStatus] = useState<{ kind: "info" | "error" | "ok" | "warn"; text: string } | null>(null);
  // "Paste from assistant": a draft only pre-fills a form; the instructor still checks, signs and saves (lib/assistant-draft.ts).
  const [pasteOpen, setPasteOpen] = useState(false);
  // Save now, sign later (Tony 2026-10-22): lessons saved without signatures, and the To sign queue that signs them.
  const [unsigned, setUnsigned] = useState<UnsignedLessonItem[]>([]);
  const [signQueue, setSignQueue] = useState<{ startLessonId: string | null } | null>(null);
  // After signing in the To sign queue: the open learner's History and totals refresh, nothing else (a running lesson,
  // an open History Edit or a half-typed past lesson are left alone).
  const refreshDetail = async (id: string) => {
    try {
      const data = await api<Detail>(`/api/learners/${encodeURIComponent(id)}`);
      if (selectedRef.current !== id) return;
      // The revisions panel belongs to one loaded copy of the lessons (as in loadLearner).
      setRevisionsOpenId(null);
      setRevisions(null);
      setDetail((current) => (current && current.learner.id === id ? data : current));
      setSummaries((current) => ({ ...current, [id]: summaryFromDetail(data) }));
    } catch {
      // The History simply keeps its last copy; the queue already shows the lesson as signed.
    }
  };
  const loadUnsigned = useCallback(() => {
    void api<{ lessons: UnsignedLessonItem[] }>("/api/unsigned-lessons").then((data) => setUnsigned(data.lessons)).catch(() => undefined);
  }, []);
  const [pasteText, setPasteText] = useState("");
  const [pasteProblems, setPasteProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [clock, setClock] = useState(() => localNow().time);
  const finishOdoRef = useRef<HTMLInputElement>(null);
  // End Lesson focuses the finish odometer (keyboard up, as before). Done in a layout effect of the commit that enables
  // the input — not on a timer — so the focus scroll happens with the End Lesson tap itself and nothing moves afterwards.
  const focusFinishOdo = useRef(false);
  useLayoutEffect(() => {
    if (!focusFinishOdo.current || finishOdoRef.current?.disabled !== false) return;
    focusFinishOdo.current = false;
    finishOdoRef.current.focus();
  });
  // Start Lesson sits under the learner header; after the tap the page moves to the lesson card (its odometer and
  // competencies), in the commit that renders the running lesson, so nothing jumps later.
  const lessonCardRef = useRef<HTMLElement>(null);
  const scrollToLesson = useRef(false);
  useLayoutEffect(() => {
    const card = lessonCardRef.current;
    if (!scrollToLesson.current || !card || card.dataset.phase === "ready") return;
    scrollToLesson.current = false;
    card.scrollIntoView({ block: "start" });
  });
  // Latest requested learner — lets a slow /api/learners/:id response be dropped if the selection changed meanwhile (e.g. a view switch).
  const selectedRef = useRef("");

  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<LessonDraft | null>(null);
  const [editOriginal, setEditOriginal] = useState<LessonDraft | null>(null);
  // Set while editing a paper_import lesson: optional times/odometer, "Signed on paper" select instead of signature pads.
  const [editPaperSignature, setEditPaperSignature] = useState<SignatureStatus | null>(null);
  // History Edit of an app lesson saved to sign later: signatures optional (both or neither), nothing to invalidate.
  const [editUnsigned, setEditUnsigned] = useState(false);
  const [pastLesson, setPastLesson] = useState<{ date: string; start: string; finish: string; error: string | null } | null>(null);
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
  // SaaS edition (spec 2026-10-21-saas-edition-design §8), from /api/me: every saas-only branch below hangs off `isSaas`.
  const [appMode, setAppMode] = useState<"private" | "saas">(mode);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
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
  // Learner form (concept screen B): the only client-side pre-check is the name; shown inline after a Save tap, cleared by typing.
  const [nameError, setNameError] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
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
    setPastLesson(null);
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
      setSummaries((current) => ({ ...current, [id]: summaryFromDetail(data) }));
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
          api<{ learners: Learner[]; summaries: Record<string, LearnerListSummary> }>("/api/learners"),
          api<{ instructors: Instructor[] }>("/api/instructors"),
          api<{ instructor: { id: string; fullName: string } | null; mode?: "private" | "saas"; trialEndsAt?: string | null }>("/api/me"),
        ]);
        setLearners(learnerData.learners);
        setSummaries((current) => ({ ...current, ...learnerData.summaries }));
        setInstructors(instructorData.instructors);
        setSignedInAs(meData.instructor?.fullName ?? null);
        setSignedInInstructorId(meData.instructor?.id ?? null);
        if (meData.mode === "saas") {
          setAppMode("saas");
          setTrialEndsAt(meData.trialEndsAt ?? null);
        }
        const start = initialSelection({ signedInInstructorId: meData.instructor?.id ?? null, activeLearners: learnerData.learners, lastLearnerId: storage.get(LAST_LEARNER_KEY) });
        setView(start.view);
        setReady(true);
        // Archived learners load in the background too, so the duplicate-licence check covers them; a failure just leaves the "not checked" note.
        void api<{ learners: Learner[] }>("/api/learners?status=archived&summaries=0")
          .then((data) => setArchivedLearners((current) => current ?? data.learners))
          .catch(() => undefined);
        loadUnsigned();
        if (start.learnerId) await loadLearner(start.learnerId);
        else if (!learnerData.learners.length) setAddingLearner(true);
      } catch (error) {
        setStatus({ kind: "error", text: (error as Error).message });
        setReady(true);
      }
    })();
  }, [loadLearner, loadUnsigned]);

  // After "Show all learners": focus the open learner's card, else the first card (keyboard / screen-reader continuity).
  useEffect(() => {
    if (!listExpanded || !focusCardAfterExpand.current) return;
    focusCardAfterExpand.current = false;
    const card = document.querySelector<HTMLElement>('[data-testid="learner-card"][aria-current="true"]') ?? document.querySelector<HTMLElement>('[data-testid="learner-card"]');
    card?.focus({ preventScroll: true });
  }, [listExpanded]);

  // "+ New learner" / "Edit learner" show only the form (the open learner's panels are hidden, their data untouched):
  // bring the form's top on screen so the instructor is not left looking at the collapsed list above it.
  const learnerFormRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (addingLearner) learnerFormRef.current?.scrollIntoView({ block: "start" });
  }, [addingLearner, editingLearner]);

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
    scrollToLesson.current = true;
    setStatus(null);
    setDraft((current) => (current ? { ...current, lessonDate: now.date, startTime: now.time, finishTime: "" } : current));
  };

  // Record a past lesson (Tony 2026-10-22): a lesson written up afterwards takes its date and times as typed, not from
  // the clock; everything after that is the normal ended-lesson form (odometer, competencies, save / sign later).
  const openPastLesson = () => setPastLesson({ date: localNow().date, start: "", finish: "", error: null });
  const usePastLesson = () => {
    if (!pastLesson) return;
    const { date, start, finish } = pastLesson;
    let error: string | null = null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error = "Enter the lesson date.";
    else if (date > localNow().date || (date === localNow().date && finish > localNow().time)) error = "The lesson cannot end in the future.";
    else if (durationMinutes(start, finish) === null) error = "Enter start and finish time; finish must be after start.";
    if (error) return setPastLesson({ ...pastLesson, error });
    scrollToLesson.current = true;
    focusFinishOdo.current = true;
    setStatus(null);
    setDraft((current) => (current ? { ...current, lessonDate: date, startTime: start, finishTime: finish } : current));
    setPastLesson(null);
  };

  const endLesson = () => {
    focusFinishOdo.current = true;
    setDraft((current) => (current ? { ...current, finishTime: localNow().time } : current));
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
      setSummaries((current) => ({ ...current, [learner.id]: emptySummary() }));
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
      fullName: l.fullName, address: l.address ?? "", addressSuburb: l.addressSuburb ?? "", addressState: l.addressState ?? "", addressPostcode: l.addressPostcode ?? "",
      phone: l.phone ?? "", dob: l.dob ?? "", licenceNumber: l.licenceNumber ?? "",
      licenceExpiry: l.licenceExpiry ?? "", eligibility: l.eligibility ?? "", transmission: l.transmission ?? "", schoolWork: l.schoolWork ?? "",
      learnerLicenceIssuedOn: l.learnerLicenceIssuedOn ?? "", learnerLicenceFirstIssuedOn: l.learnerLicenceFirstIssuedOn ?? "", hptPassedOn: l.hptPassedOn ?? "",
      loggedHours: l.loggedHours === null ? "" : String(l.loggedHours), loggedHoursOn: l.loggedHoursOn ?? "",
      otherLicenceKind: l.otherLicenceKind ?? "", otherLicencePlace: l.otherLicencePlace ?? "", otherLicenceNumber: l.otherLicenceNumber ?? "",
      otherLicenceClass: l.otherLicenceClass ?? "", otherLicenceIssuedOn: l.otherLicenceIssuedOn ?? "", otherLicenceExpiresOn: l.otherLicenceExpiresOn ?? "",
      licenceStage: l.licenceStage, instructorId: l.instructorId,
    };
    // Opened as stored (no auto-fill yet): an untouched save must send no change. The panel and PDF show the live value anyway.
    setLearnerDraft(opened);
    setDraftNotesText(l.draftNotes ?? "");
    setOpenedLearnerDraft(opened);
    setHoursOnTouched(false);
    setEditLearnerId(l.id);
    setEditingLearner(true);
    setAddingLearner(true);
    setListExpanded(false);
    setNameError(false);
    setStatus(null);
  };

  const closeLearnerForm = () => {
    setAddingLearner(false);
    setEditingLearner(false);
    setEditLearnerId(null);
    setNameError(false);
    // The Transfer / Archive panels live inside the Edit form's More: leaving the form drops an open panel (nothing was sent).
    setTransferDraft(null);
    setArchiveDraft(null);
  };

  // The sticky bar's Save: an empty name is caught here, inline (same wording as the server); everything else is still
  // validated by the server exactly as before (distinct messages shown in the status line).
  // Save as draft (new learner) or Save draft (editing one): nothing is required and nothing is refused for being invalid;
  // the server drops what it cannot use and writes it to the notes. The learner then waits for a review and Confirm.
  const saveAsDraft = async () => {
    setSaving(true);
    setStatus(null);
    try {
      if (editingLearner && editLearnerId) {
        const { instructorId: _owner, ...fields } = learnerDraft;
        void _owner;
        const result = await api<{ learner: Learner }>(`/api/learners/${encodeURIComponent(editLearnerId)}`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fields, draft: true, draftNotes: draftNotesText }),
        });
        setLearners((current) => current.map((l) => (l.id === result.learner.id ? result.learner : l)).sort((a, b) => a.fullName.localeCompare(b.fullName)));
        closeLearnerForm();
        await loadLearner(result.learner.id);
        setStatus({ kind: "ok", text: "Draft saved." });
      } else {
        const { learner } = await api<{ learner: Learner }>("/api/learners", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...learnerDraft, draft: true, draftNotes: draftNotesText }),
        });
        storage.set(LAST_INSTRUCTOR_KEY, learner.instructorId);
        setLearners((current) => [...current, learner].sort((a, b) => a.fullName.localeCompare(b.fullName)));
        setSummaries((current) => ({ ...current, [learner.id]: emptySummary() }));
        closeLearnerForm();
        setLearnerDraft(emptyLearner);
        await loadLearner(learner.id);
        setStatus({ kind: "ok", text: "Draft saved. Review it and confirm when it is right." });
      }
    } catch (error) {
      setStatus({ kind: "error", text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  // Confirm learner: the draft becomes a normal learner, with every rule of a normal learner applied by the server.
  const confirmDraftLearner = async () => {
    if (!editLearnerId) return;
    setSaving(true);
    setStatus(null);
    try {
      const { instructorId: _owner, ...fields } = withSaveEligibility(learnerDraft);
      void _owner;
      const result = await api<{ learner: Learner }>(`/api/learners/${encodeURIComponent(editLearnerId)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fields, draft: false }),
      });
      setLearners((current) => current.map((l) => (l.id === result.learner.id ? result.learner : l)).sort((a, b) => a.fullName.localeCompare(b.fullName)));
      closeLearnerForm();
      await loadLearner(result.learner.id);
      setStatus({ kind: "ok", text: `${result.learner.fullName} confirmed. Ready for Lesson #1.` });
    } catch (error) {
      setStatus({ kind: "error", text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const submitLearnerForm = () => {
    if (editingLearner && detail?.learner.draftAt) {
      if (nameIssue(learnerDraft.fullName) || learnerDraft.fullName.trim() === "Unnamed draft") {
        setNameError(true);
        nameInputRef.current?.focus();
        return;
      }
      void confirmDraftLearner();
      return;
    }
    if (nameIssue(learnerDraft.fullName)) {
      setNameError(true);
      nameInputRef.current?.focus();
      return;
    }
    if (!editingLearner && draftNotesText.trim() && !window.confirm("The notes for review are kept only with a draft and will be discarded. Save the learner anyway? (Cancel, then use Save as draft, to keep them.)")) return;
    void (editingLearner ? saveLearnerEdit() : addLearner());
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

  const saveLesson = async (signLater = false) => {
    if (!detail || !draft) return;
    const problems = validateLessonDraftFields(draft, "new", { signLater });
    if (problems.length) {
      setSaveIssues({ source: "client", issues: problems, snapshot: draft, signLater });
      setSaveAttempt((n) => n + 1);
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const result = await api<{ lesson: Lesson; totals: Totals; progress: LearnerProgress; completion: CompletionSummary | null }>(
        `/api/learners/${encodeURIComponent(detail.learner.id)}/lessons`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, signLater }) },
      );
      storage.remove(draftKey(detail.learner.id));
      setSaveIssues(null);
      const next: Detail = { ...detail, totals: result.totals, progress: result.progress, completion: result.completion, lessons: [result.lesson, ...detail.lessons] };
      setDetail(next);
      setSummaries((current) => ({ ...current, [detail.learner.id]: summaryFromDetail(next) }));
      setDraft(freshLesson(result.totals.lastFinishOdometer));
      if (result.lesson.signatureStatus === "unsigned") {
        loadUnsigned();
        setStatus({ kind: "warn", text: `Lesson #${result.lesson.lessonNo} saved, not signed yet. Sign it later from "To sign" at the top.` });
      } else setStatus({ kind: "ok", text: `Lesson #${result.lesson.lessonNo} saved.` });
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
      setEditUnsigned(data.lesson.recordSource === "app" && data.lesson.signatureStatus === "unsigned");
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
    setEditUnsigned(false);
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
      if (!editPaperSignature && !editUnsigned && contentChanged(editOriginal, next) && next.learnerSignature === editOriginal.learnerSignature) {
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
    const problems = validateLessonDraftFields(editDraft, editPaperSignature ? "paper" : "edit", { signLater: editSignatureOptionalNow });
    if (problems.length) {
      setEditIssues({ source: "client", issues: problems, snapshot: editDraft, signLater: editSignatureOptionalNow });
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
      loadUnsigned();
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
    setListExpanded(false);
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
    setListExpanded(true);
    // The open learner only stays if they belong to the target view — never leave an active learner showing in Archived (or vice versa).
    const open = detail?.learner ?? [...learners, ...(archivedLearners ?? [])].find((l) => l.id === selectedId);
    if (selectionAfterViewChange(open, next, signedInInstructorId) === "clear") {
      clearSelection();
      setStatus(null);
    }
    if (next === "archived" && !archivedSummariesLoaded) loadArchivedSummaries();
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
      // The action sits inside the Edit learner form (Tony's decision 3): a done transfer closes the form so the learner's
      // page (History line, new owner) shows at once — the sender usually cannot edit the learner any more anyway.
      closeLearnerForm();
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
    setDraftNotesText("");
    setEditingLearner(false);
    setAddingLearner(true);
    setListExpanded(false);
    setHoursOnTouched(false);
    setNameError(false);
    setStatus(null);
  };

  const closePaste = () => {
    setPasteOpen(false);
    setPasteText("");
    setPasteProblems([]);
  };

  const applyAssistantDraft = async (saveNow = false) => {
    const parsed = parseAssistantDraft(pasteText);
    if (parsed.kind === "none") return setPasteProblems(parsed.problems);
    const notes = [...parsed.problems];
    if (parsed.kind === "learner") {
      const f = parsed.fields;
      // Full name, or a first name only one instructor has; anything else is left for the instructor to pick.
      const norm = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();
      const wanted = norm(f.instructorName);
      const byFull = instructors.filter((i) => norm(i.fullName) === wanted);
      const byFirst = instructors.filter((i) => norm(i.fullName).split(" ")[0] === wanted);
      const instructor = !wanted ? undefined : byFull.length === 1 ? byFull[0] : byFull.length === 0 && byFirst.length === 1 ? byFirst[0] : undefined;
      if (wanted && !instructor) notes.push(`Instructor "${f.instructorName}" was not matched to exactly one instructor; pick one in the form.`);
      const reviewNotes = [f.notes, ...notes.filter((n) => !/^Student name is missing/.test(n))].filter(Boolean).join("\n");
      if (saveNow) {
        // Straight to a DRAFT (nothing else is saved): the instructor reviews it later and confirms it.
        setSaving(true);
        try {
          const { learner } = await api<{ learner: Learner }>("/api/learners", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({
              fullName: f.fullName, phone: f.phone, dob: f.dob, licenceNumber: f.licenceNumber, licenceExpiry: f.licenceExpiry, address: f.address,
              schoolWork: f.schoolWork, transmission: f.transmission, eligibility: f.eligibility, ...(instructor ? { instructorId: instructor.id } : {}),
              draft: true, draftNotes: reviewNotes,
            }),
          });
          setLearners((current) => [...current, learner].sort((a, b) => a.fullName.localeCompare(b.fullName)));
          setSummaries((current) => ({ ...current, [learner.id]: emptySummary() }));
          closePaste();
          setStatus({ kind: "warn", text: `Saved as a draft: ${learner.fullName}. Open it from the list to review and confirm.` });
        } catch (error) {
          setPasteProblems([...notes, (error as Error).message]);
        } finally {
          setSaving(false);
        }
        return;
      }
      if (addingLearner && !window.confirm("The learner form is open. Replace what is in it with the assistant's draft?")) return;
      openAddLearner();
      setDraftNotesText(reviewNotes);
      setLearnerDraft((current) => ({
        ...current, fullName: f.fullName, phone: f.phone, dob: f.dob, licenceNumber: f.licenceNumber, licenceExpiry: f.licenceExpiry,
        address: f.address, schoolWork: f.schoolWork, transmission: f.transmission, eligibility: f.eligibility,
        ...(instructor ? { instructorId: instructor.id } : {}),
      }));
      closePaste();
      const text = "Learner draft filled in from the assistant. Check every field, then Save learner.";
      setStatus(notes.length ? { kind: "warn", text: `${text} Please check: ${notes.join(" ")}` } : { kind: "ok", text });
      return;
    }
    const f = parsed.fields;
    const matches = matchLearnersByName(learners.filter((l) => !l.draftAt), f.learnerName);
    if (matches.length === 0 && matchLearnersByName(learners.filter((l) => l.draftAt), f.learnerName).length > 0) {
      return setPasteProblems([...notes, `"${f.learnerName.trim()}" is still a draft. Review and confirm the learner first, then enter the lesson.`]);
    }
    if (matches.length !== 1) {
      return setPasteProblems([...notes, matches.length
        ? `${matches.length} active learners are called "${f.learnerName.trim()}". Open the right one and enter the lesson there.`
        : `No active learner is called "${f.learnerName.trim()}". Check the spelling, or create the learner first.`]);
    }
    // Times are never taken from the clock for a written-up lesson: without them the draft would sit hidden behind Start Lesson.
    if (!f.lessonDate || !f.startTime) return setPasteProblems([...notes, "A lesson draft needs its Date and Start time. Add them and paste again."]);
    const learner = matches[0];
    let running = learner.id === selectedId && Boolean(draft?.startTime);
    try {
      const existing = storage.get(draftKey(learner.id));
      if (existing && (JSON.parse(existing) as Partial<LessonDraft>).startTime) running = true;
    } catch { running = true; }
    if (running && !window.confirm(`${learner.fullName} already has a lesson in progress on this device. Replace it with the assistant's draft?`)) return;
    const saved: Partial<LessonDraft> = {
      lessonDate: f.lessonDate, taughtIds: f.taughtIds, assessedIds: f.assessedIds, achievedResults: f.achievedResults,
      location: f.location, comments: f.comments, adiSignature: "", learnerSignature: "",
    };
    // Empty values are left out, so the carried start odometer (from the last lesson) is kept.
    for (const key of ["startTime", "finishTime", "startOdometer", "finishOdometer"] as const) if (f[key]) saved[key] = f[key];
    if (!f.finishTime) notes.push("Finish time is missing: use End Lesson or Edit date / times.");
    const json = JSON.stringify(saved);
    storage.set(draftKey(learner.id), json);
    if (storage.get(draftKey(learner.id)) !== json) return setPasteProblems(["This device would not keep the draft (browser storage is blocked or full). Nothing was changed."]);
    if (activeView === "archived") chooseView("mine");
    pickLearner(learner.id);
    closePaste();
    const text = `Lesson draft filled in for ${learner.fullName}. Check every field, then save it: signed now, or later from To sign.`;
    setStatus(notes.length ? { kind: "warn", text: `${text} Please check: ${notes.join(" ")}` } : { kind: "ok", text });
  };

  // Live, derived values for the current lesson.
  const liveDuration = draft ? durationMinutes(draft.startTime, draft.finishTime) : null;
  const liveKm = draft ? distanceKm(parseOdometer(draft.startOdometer), parseOdometer(draft.finishOdometer)) : null;
  const startedMinutes = draft ? parseTime(draft.startTime) : null;
  const nowMinutes = parseTime(clock);
  const elapsed = startedMinutes !== null && nowMinutes !== null && nowMinutes >= startedMinutes ? nowMinutes - startedMinutes : null;
  const phase = lessonPhase(draft);
  const lessonNo = nextLessonNo(totals);
  // Big-figure derived values for the odometer block (lib/lesson-view.ts): calculated, never typed.
  const stats = derivedStats({ totals, liveDuration, liveKm });
  // Prior-instructor records (spec §12) are shown as compact cards, never as editable lessons.
  const history = splitPriorRecords(detail?.lessons ?? []);
  const shownSaveIssues = draft ? currentIssues(saveIssues, draft, "new") : [];
  // A correction to an app lesson may be saved without signatures (it becomes "not signed"), except Final Drive 23.
  const editSignOptional = editPaperSignature === null && Boolean(editDraft) && !editDraft!.assessedIds.includes(FINAL_DRIVE_23) && !editOriginal?.assessedIds.includes(FINAL_DRIVE_23);
  // Signatures may be left blank when the lesson is already unsigned, or when a correction changed a signed one.
  const editSignatureOptionalNow = editUnsigned || (editSignOptional && Boolean(editOriginal && editDraft && contentChanged(editOriginal, editDraft)));
  const shownEditIssues = editDraft ? currentIssues(editIssues, editDraft, editPaperSignature ? "paper" : "edit") : [];

  // Only a licence-date/DOB edit refreshes an app-owned Eligibility; typing in Eligibility itself never auto-fills (so it can be cleared or rewritten).
  const learnerField = (key: keyof LearnerDraft, value: string) =>
    setLearnerDraft((current) => (isEligibilityDateKey(key) ? withAutoEligibility({ ...current, [key]: value }) : { ...current, [key]: value }));
  // Intake P3 D12: "No" clears the other licence's details (old values stay in the revision history); the kind moves the C23 date, so the auto-fill follows.
  const otherLicenceKindField = (kind: string) => setLearnerDraft((current) => withAutoEligibility(withOtherLicenceKind(current, kind)));
  // D7: typing keeps the picked suburb/state/postcode only while the suburb is still a whole word of the text.
  const addressTextField = (text: string) =>
    setLearnerDraft((current) => {
      const parts = current.addressSuburb ? partsAfterEdit(text, { suburb: current.addressSuburb, state: current.addressState, postcode: current.addressPostcode }) : null;
      return { ...current, address: text, addressSuburb: parts?.suburb ?? "", addressState: parts?.state ?? "", addressPostcode: parts?.postcode ?? "" };
    });
  const addressPicked = (s: AddressSuggestion) =>
    setLearnerDraft((current) => ({ ...current, address: s.label, addressSuburb: s.suburb, addressState: s.state, addressPostcode: s.postcode }));
  // Logged hours always come with an "as of" date (server rule D19): typing hours fills it with today (editable) unless the instructor set it by hand; clearing the hours clears it.
  const [hoursOnTouched, setHoursOnTouched] = useState(false);
  const loggedHoursField = (raw: string) =>
    setLearnerDraft((current) => {
      const digits = raw.replace(/\D/g, "").slice(0, 3);
      if (!digits) return { ...current, loggedHours: "", loggedHoursOn: "" };
      return { ...current, loggedHours: digits, loggedHoursOn: hoursOnTouched && current.loggedHoursOn ? current.loggedHoursOn : localNow().date };
    });

  const isSaas = appMode === "saas";
  // SaaS: the trial line on every render (`clock` re-renders every 15 s); once expired every control that writes is disabled, with the banner saying why.
  const trial = isSaas ? trialBanner(trialEndsAt ?? "", new Date()) : null;
  const trialExpired = trial?.kind === "expired";
  // No Access identity (local dev) means "My learners" has no meaning. SaaS: an account sees only its own learners, so no "All".
  const views = isSaas ? availableViews(signedInInstructorId).filter((v) => v !== "all") : availableViews(signedInInstructorId);
  const activeView: PickerView = views.includes(view) ? view : isSaas ? "mine" : "all";
  // The list = exactly this view's members (search narrows it); the open learner is never injected into a view they don't belong to.
  const viewMembers = viewLearners(learners, archivedLearners ?? [], activeView, signedInInstructorId);
  const searchResults = filterLearners(viewMembers, { scope: "all", instructorId: signedInInstructorId, query }).sort((a, b) => Number(Boolean(b.draftAt)) - Number(Boolean(a.draftAt)));
  const mineCount = viewLearners(learners, [], "mine", signedInInstructorId).length;
  const viewLabel = (v: PickerView) => (v === "mine" ? "Mine" : v === "all" ? "All" : "Archived");
  const viewCount = (v: PickerView) => (v === "mine" ? mineCount : v === "all" ? learners.length : archivedLearners ? archivedLearners.length : null);
  const viewSubline = activeView === "mine" ? "Your active learners" : activeView === "all" ? "Everyone in the school" : "Hidden from the daily list";
  // Card data: what the list GET sent (or the detail of an opened learner); a learner added on this device starts empty.
  // Null only for an archived learner whose summaries fetch failed: that card shows no figures rather than zeros.
  const summaryOf = (l: Learner): LearnerListSummary | null => summaries[l.id] ?? (l.archivedAt === null ? emptySummary() : null);
  const today = localNow().date;
  const cardsOf = (list: readonly Learner[]) => list.map((l) => { const summary = summaryOf(l); return { learner: l, summary, reminders: summary && !l.draftAt ? cardReminders(l, summary, today) : [] }; });
  // A compact list while a learner is open (or the learner form is open): their card, plus "Show all learners", which
  // always works — switching learner while the edit form is open discards that form, as with the former dropdown.
  const openCard = selectedId ? viewMembers.find((l) => l.id === selectedId) : undefined;
  const collapsed = listCollapsed({ query, expanded: listExpanded, formOpen: addingLearner, openInView: openCard !== undefined });
  const shownCards = cardsOf(collapsed ? collapsedCards({ formOpen: addingLearner, openCard }) : searchResults);
  const hiddenCards = collapsed ? viewMembers.length - shownCards.length : 0;
  // Archived card data arrives with the Archived tab's own fetch; until then the list shows a loading line, never zeros.
  // If that fetch failed, the cards show without details plus a retry line.
  const listLoading = activeView === "archived" && !archivedSummariesLoaded && archivedSummariesError === null;
  const listDetailsFailed = activeView === "archived" && !archivedSummariesLoaded && archivedSummariesError !== null;
  const viewGlance = glance(cardsOf(viewMembers).filter((c) => c.summary !== null).map((c) => ({ summary: c.summary as LearnerListSummary, reminders: c.reminders })));
  const emptyListText = query.trim()
    ? `No matching learners${activeView === "mine" && !isSaas ? ' — try "All"' : ""}.`
    : activeView === "archived" ? "No archived learners." : "No learners here yet.";
  const panel = detail ? learnerPanel({ archivedAt: detail.learner.archivedAt, completed: detail.progress.completed, draftAt: detail.learner.draftAt ?? null }) : "active";
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
        <button type="button" className="btn primary" disabled={saving || phase !== "ready" || trialExpired} onClick={() => void setLearnerArchived(true)} data-testid="archive-confirm">Archive learner</button>
      </div>
    </div>
  ) : null;

  // Transfer (3c T1): the learner's own instructor, or anyone active when that instructor is inactive (not in the
  // active-only instructors list). Never for an archived learner (restore first). The server enforces the same rules.
  const homeInactive = Boolean(detail) && instructors.length > 0 && !instructors.some((i) => i.id === detail?.learner.instructorId);
  const canTransfer = !isSaas && Boolean(detail) && panel !== "archived" && panel !== "draft" && (!signedInInstructorId || signedInInstructorId === detail?.learner.instructorId || homeInactive);
  const transferTargets = detail ? instructors.filter((i) => i.id !== detail.learner.instructorId) : [];
  const openTransferPanel = () => {
    setArchiveDraft(null);
    setTransferDraft({ toId: transferTargets.length === 1 ? transferTargets[0].id : "", note: "" });
  };
  const transferTargetName = transferTargets.find((i) => i.id === transferDraft?.toId)?.fullName ?? null;
  // Concept screen B / Tony's decision 3: Transfer and Archive live in the EDIT form's folded "More". The one case the form
  // cannot reach — a colleague rescuing a learner whose instructor is inactive (not the owner, so no Edit learner) — keeps
  // the Transfer link on the learner's page, so the rule stays reachable exactly as before.
  const more = moreSection({ editing: editingLearner, canTransfer, panel });
  // A done transfer or archive closes the Edit form, so both wait until unsaved edits are saved or cancelled (review 2026-10-13).
  const formDirty = editingLearner && openedLearnerDraft !== null && JSON.stringify(openedLearnerDraft) !== JSON.stringify(learnerDraft);
  const moreLocked = phase !== "ready" || formDirty;
  const moreLockedNote = moreLockedMessage({ phase, formDirty });
  const transferPanel = detail && transferDraft ? (
    <div className="lifecycle transfer-panel" data-testid="transfer-panel">
      <p><b>Transfer {detail.learner.fullName}</b> to another instructor. Lessons already recorded stay with whoever recorded them.</p>
      {transferTargets.length ? (
        <fieldset className="transfer-choices">
          <legend>New instructor</legend>
          {transferTargets.map((i) => (
            <label key={i.id} className="transfer-choice">
              <input type="radio" name="transfer-to" value={i.id} checked={transferDraft.toId === i.id} onChange={() => setTransferDraft({ ...transferDraft, toId: i.id })} data-testid="transfer-choice" />
              <span>{instructorLabel(i)}</span>
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
  // Intake P3 D13 (e): grey "add the type and issue date" while the recorded interstate / overseas licence cannot be read yet (form, panel, lesson form).
  const formOtherLicenceLine: Reminder | null = addingLearner ? otherLicenceDataReminder(draftEligibilityLearner(learnerDraft)) : null;
  const panelOtherLicenceLine: Reminder | null = detail ? otherLicenceDataReminder(detail.learner) : null;
  const panelReminders: Reminder[] = [];
  let showBookingLink = false;
  if (detail && phase === "ready" && panel === "active") {
    const gap = (review: typeof REVIEW_1_17 | typeof REVIEW_1_22) => reviewGapReminder({ review, progress: detail.progress, lessons: lessonRefs, moment: { kind: "now", now: rulesNow }, where: "panel" });
    const next = detail.progress.review1_17.status === "ready" ? gap(REVIEW_1_17) : detail.progress.review1_22.status === "ready" ? gap(REVIEW_1_22) : null;
    if (next) panelReminders.push(next);
    if (detail.progress.finalDrive23.status === "ready") {
      panelReminders.push(finalDriveEligibilityReminder(detail.learner, localNow(rulesNow).date));
      if (panelOtherLicenceLine) panelReminders.push(panelOtherLicenceLine);
      panelReminders.push(finalDrivePanelReminder(rulesNow));
      // R10 D5: the unfamiliar town centres (home district from the address), read before the lesson, never a verdict.
      panelReminders.push(routeSuggestionReminder(detail.learner));
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
    if (draft.assessedIds.includes(FINAL_DRIVE_23)) {
      formReminders.push(finalDriveEligibilityReminder(detail.learner, draft.lessonDate));
      if (panelOtherLicenceLine) formReminders.push(panelOtherLicenceLine);
      formReminders.push(...finalDriveFormReminders({ date: draft.lessonDate, startTime: draft.startTime, finishTime: draft.finishTime }));
    }
  }
  // R10 (D3-D9): the route check lives in the draft's own location + comments (one generated line), parsed back on every render.
  const home = homeDistrict(detail?.learner ?? null);
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
  const fitsRoute = (current: LessonDraft) => routeFits({ location: current.location, comments: current.comments });

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" width={34} height={34} alt="" />
          <div className="brand-name">
            <strong>{isSaas ? "Instructor Assistant" : "ACTGDS Instructor"}</strong>
            <small>CBT&amp;A Lesson Checklist</small>
          </div>
          {signedInAs ? (
            <div className={isSaas ? "signed-in-as saas" : "signed-in-as"}>
              <span>Signed in as {signedInAs}</span>
              {isSaas ? <a href="/account" className="signout-link" data-testid="account-link">Account</a> : null}
              <a href={logoutUrl} className="signout-link" data-testid="signout-link">Sign out</a>
            </div>
          ) : null}
          <ThemeToggle />
        </div>
        <div className="headline">
          <div>
            <h1>Learners</h1>
            {ready ? <span className="headline-sub" data-testid="view-subline">{viewSubline}</span> : null}
          </div>
          {ready ? (
            <button type="button" className="btn gold new-learner" disabled={trialExpired && !addingLearner} onClick={() => (addingLearner ? closeLearnerForm() : openAddLearner())} data-testid="new-learner">
              {addingLearner ? "Cancel" : "+ New learner"}
            </button>
          ) : null}
        </div>
      </header>

      {trial ? (
        <a href="/account" className={`trial-banner ${trial.kind}`} data-testid="trial-banner" data-kind={trial.kind}>
          <span>{trial.text}</span>
          {trialExpired ? <small data-testid="trial-readonly-note">Adding or changing learners, lessons and signatures is switched off. History and PDF export still work.</small> : null}
        </a>
      ) : null}

      <section className="card picker" data-selected={selectedId}>
        {!ready ? (
          <p className="empty" data-testid="picker-loading" role="status">Loading your learners…</p>
        ) : (
          <>
        <label className="search">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="9" r="6" /><path d="m14 14 4 4" /></svg>
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
        </label>
        {/* "Paste from assistant" reads ACTGDS's own assistant format (ACTGDS-DRAFT): private edition only. */}
        {isSaas ? null : pasteOpen ? (
          <div className="paste-draft" data-testid="paste-draft">
            <label className="field">
              <span>Paste the assistant&rsquo;s draft (it starts with ACTGDS-DRAFT)</span>
              <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6} autoFocus spellCheck={false} data-testid="paste-draft-text" />
            </label>
            {pasteProblems.length ? (
              <ul className="paste-problems" role="alert" data-testid="paste-draft-problems">
                {pasteProblems.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            ) : null}
            <div className="paste-actions">
              <button type="button" className="btn primary" disabled={!pasteText.trim() || saving} onClick={() => void applyAssistantDraft()} data-testid="paste-draft-use">Fill in the form</button>
              {/^\s*[`*#>\s]*ACTGDS-DRAFT\s+LEARNER/im.test(pasteText) ? <button type="button" className="btn ghost" disabled={saving || trialExpired} onClick={() => void applyAssistantDraft(true)} data-testid="paste-draft-save-draft">Save as draft now</button> : null}
              <button type="button" className="btn ghost" onClick={closePaste}>Cancel</button>
            </div>
            <p className="hint-note">"Fill in the form" saves nothing: you check it, then save it. "Save as draft now" keeps a learner block as a draft to review later.</p>
          </div>
        ) : (
          <button type="button" className="link paste-link" onClick={() => setPasteOpen(true)} disabled={saving || trialExpired} data-testid="paste-draft-open">Paste from assistant</button>
        )}
        {unsigned.length && !signQueue ? (
          <button type="button" className="to-sign" disabled={trialExpired} onClick={() => setSignQueue({ startLessonId: null })} data-testid="to-sign-open">
            To sign: {unsigned.length} {unsigned.length === 1 ? "lesson" : "lessons"}
          </button>
        ) : null}
        {signQueue ? (
          <SignQueue
            key={signQueue.startLessonId ?? "queue"}
            items={unsigned}
            startLessonId={signQueue.startLessonId}
            readOnly={trialExpired}
            onSigned={(item) => {
              setUnsigned((current) => current.filter((i) => i.lessonId !== item.lessonId));
              if (detail?.learner.id === item.learnerId) void refreshDetail(item.learnerId);
            }}
            onClose={() => { setSignQueue(null); loadUnsigned(); }}
          />
        ) : null}
        <div className="view-tabs" role="group" aria-label="Which learners to show">
          {views.map((v) => (
            <button key={v} type="button" className={`view-tab${activeView === v ? " active" : ""}`} aria-pressed={activeView === v} onClick={() => chooseView(v)}>
              {viewLabel(v)}
              {viewCount(v) !== null ? <em className="view-count">{viewCount(v)}</em> : null}
            </button>
          ))}
        </div>
        {activeView !== "archived" ? (
          <p className="glance" data-testid="glance">
            <span><b>{viewGlance.learning}</b> learning</span>
            <span className={viewGlance.withReminder ? "warn" : ""}><b>{viewGlance.withReminder}</b> with a reminder</span>
            <span><b>{viewGlance.readyForFinalDrive}</b> ready for Final Drive</span>
          </p>
        ) : null}
        {/* Always mounted so assistive tech announces the change of text, not a new element. */}
        <p className="sr-only" aria-live="polite" data-testid="list-collapsed-note">{collapsed && hiddenCards > 0 ? (shownCards.length ? `Showing ${shownCards.length} of ${viewMembers.length} learners.` : `${viewMembers.length} learners hidden while the form is open.`) : ""}</p>
        {listDetailsFailed ? (
          <button type="button" className="link list-retry" onClick={loadArchivedSummaries} data-testid="list-retry">Card details unavailable. Tap to retry.</button>
        ) : null}
        {listLoading ? <p className="empty" data-testid="list-loading" role="status">Loading archived learners…</p> : (
        <ul className="learner-list" data-testid="learner-list" aria-label={activeView === "archived" ? "Archived learners" : "Learners"}>
          {shownCards.map(({ learner: l, summary: s, reminders }) => {
            const selected = l.id === selectedId;
            return (
              <li key={l.id}>
                <button
                  type="button"
                  className={`lcard${selected ? " selected" : ""}`}
                  onClick={() => pickLearner(l.id)}
                  aria-current={selected ? "true" : undefined}
                  data-testid="learner-card"
                  data-learner-id={l.id}
                  data-option-label={optionLabel(l, activeView)}
                >
                  <span className="lc-top">
                    <span className="lc-avatar" aria-hidden="true">{initials(l.fullName)}</span>
                    <span className="lc-id">
                      <span className="lc-name">{l.fullName}{l.draftAt ? <span className="lc-draft" data-testid="draft-chip">Draft</span> : null}</span>
                      <span className="lc-meta">{s ? cardMeta(l, s) : "Details unavailable"}</span>
                    </span>
                    <svg className="lc-chev" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
                  </span>
                  {s ? (<>
                  <span className="lc-prog">
                    <span className="lc-prog-head">
                      <span>Competencies</span>
                      <span><b data-testid="card-achieved">{s.achievedCount}</b> of 22 · {lastLessonLine(s)}</span>
                    </span>
                    <span className="lc-segs" role="img" aria-label={`${s.achievedCount} of 22 competencies achieved`}>
                      {CORE_COMPETENCY_IDS.map((id) => <i key={id} className={s.achievedIds.includes(id) ? "on" : undefined} />)}
                    </span>
                  </span>
                  <span className="lc-gates">
                    {gateChips(s).map((g) => (
                      <span key={g.id} className={`lc-chip ${g.state}`} data-gate={g.id} data-state={g.state}>{g.state === "done" ? "✓ " : ""}{g.label}</span>
                    ))}
                    {reminders.map((r) => <span key={r.id} className={`lc-chip ${r.tone === "amber" ? "warn" : "plain"}`} data-testid="card-reminder" data-tone={r.tone}>{r.text}</span>)}
                    {activeView !== "mine" ? <span className="lc-chip" data-testid="card-instructor">Instructor {l.instructorName}</span> : null}
                  </span>
                  </>) : null}
                </button>
              </li>
            );
          })}
          {shownCards.length === 0 && !collapsed ? <li className="empty" data-testid="learner-list-empty">{emptyListText}</li> : null}
        </ul>
        )}
        {hiddenCards > 0 && !listLoading ? (
          <button type="button" className="btn ghost block list-expand" onClick={() => { focusCardAfterExpand.current = true; setListExpanded(true); }} data-testid="learner-list-expand">
            Show all learners ({viewMembers.length})
          </button>
        ) : null}
          </>
        )}
      </section>

      {status ? <p className={`status ${status.kind}`} role="status">{status.text}</p> : null}

      {addingLearner ? (
        <section className="card learner-form" ref={learnerFormRef} data-testid="learner-form">
          {/* Concept screen B (approved 2026-10-12): Student / Address / Licence & eligibility cards, the EDIT form's folded "More"
              (Transfer + Archive, Tony's decision 3) and one primary action in a sticky bottom bar. Same fields, same payloads. */}
          <div className="form-head">
            <h2>{editingLearner ? "Edit learner" : "New learner"}</h2>
            <p className="form-sub">{formSubline(editingLearner, isSaas)}</p>
          </div>
          <div className="fsections">
            <section className="lblock fsect" aria-labelledby="fsect-student" data-testid="fsect-student">
              <div className="card-head"><h3 id="fsect-student">Student</h3><small><span className="req" aria-hidden="true">*</span> required</small></div>
              <div className="grid">
                <label className={`field full${nameError ? " invalid" : ""}`}><span>Student name <span className="req" aria-hidden="true">*</span></span>
                  <input ref={nameInputRef} value={learnerDraft.fullName} onChange={(e) => { setNameError(false); learnerField("fullName", e.target.value); }} autoComplete="off" placeholder="As on the learner licence" aria-required="true" aria-invalid={nameError || undefined} aria-describedby={nameError ? "learner-name-error" : undefined} data-testid="learner-name" />
                  {nameError ? <span className="field-error" id="learner-name-error" role="alert" data-testid="learner-name-error">{nameIssue(learnerDraft.fullName) ?? ""}</span> : null}
                </label>
                <label className="field"><span>Phone</span><input type="tel" inputMode="tel" value={learnerDraft.phone} onChange={(e) => learnerField("phone", e.target.value)} /></label>
                <label className="field"><span>DOB</span><input type="date" value={learnerDraft.dob} onChange={(e) => learnerField("dob", e.target.value)} /></label>
                <label className="field"><span>Manual / Auto</span>
                  <select value={learnerDraft.transmission} onChange={(e) => learnerField("transmission", e.target.value)}>
                    <option value="">—</option>
                    <option value="auto">Auto</option>
                    <option value="manual">Manual</option>
                  </select>
                </label>
                <label className="field"><span>School / Work</span><input value={learnerDraft.schoolWork} onChange={(e) => learnerField("schoolWork", e.target.value)} /></label>
              </div>
            </section>

            <section className="lblock fsect" aria-labelledby="fsect-address" data-testid="fsect-address">
              <div className="card-head"><h3 id="fsect-address">Address</h3><small>home district for Competency 23</small></div>
              <AddressInput value={learnerDraft.address} onChange={addressTextField} onPick={addressPicked} />
              <div className="picked-parts" aria-label="Parts kept from the picked suggestion" data-testid="address-parts">
                {addressPartChips(learnerDraft).map((chip) => <span key={chip.label} className="lc-chip" data-part={chip.label}>{chip.label} · {chip.value}</span>)}
              </div>
            </section>

            <section className="lblock fsect" aria-labelledby="fsect-licence" data-testid="fsect-licence">
              <div className="card-head"><h3 id="fsect-licence">Licence &amp; eligibility</h3><small>drives the reminders</small></div>
              <div className="grid">
                <label className="field"><span>Licence number</span><input value={learnerDraft.licenceNumber} onChange={(e) => learnerField("licenceNumber", e.target.value)} autoCapitalize="characters" /></label>
                <label className="field"><span>Licence expiry</span><input type="date" value={learnerDraft.licenceExpiry} onChange={(e) => learnerField("licenceExpiry", e.target.value)} /></label>
                {formLicenceCheck ? <div className="full"><RulesReminders reminders={[formLicenceCheck]} testId="licence-duplicate" /></div> : null}
                <label className="field full"><span>Eligibility</span><input value={learnerDraft.eligibility} onChange={(e) => learnerField("eligibility", e.target.value)} data-testid="learner-eligibility" />
                  {showsAutoHint(learnerDraft.eligibility, draftEligibilityLearner(learnerDraft)) ? <small className="auto-hint" data-testid="eligibility-auto">auto: from the licence dates</small> : null}
                </label>
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
                {/* Intake P3 (migration 0013, D11): collapsed group; "Yes" opens the details. Reminder input only: nothing here blocks a save. */}
                <details className="full rules-group" key={editingLearner ? "edit-other" : "new-other"} data-testid="other-licence-group">
                  <summary>Overseas or interstate licence</summary>
                  <p className="hint-note">{OTHER_LICENCE_HINT}</p>
                  <p className="hint-note"><small>Optional; a reminder only, nothing here blocks a save or goes to the website.</small></p>
                  <div className="grid">
                    <label className="field full"><span>Holds an overseas or interstate licence?</span>
                      <select value={learnerDraft.otherLicenceKind} onChange={(e) => otherLicenceKindField(e.target.value)} data-testid="other-kind">
                        <option value="">—</option>
                        {OTHER_LICENCE_KINDS.map((kind) => <option key={kind} value={kind}>{OTHER_LICENCE_KIND_LABELS[kind]}</option>)}
                      </select>
                    </label>
                    {holdsOtherLicence(learnerDraft.otherLicenceKind) ? (
                      <>
                        <label className="field"><span>{learnerDraft.otherLicenceKind === "interstate" ? "State or territory" : "Country"}</span>
                          {learnerDraft.otherLicenceKind === "interstate" ? (
                            <select value={learnerDraft.otherLicencePlace} onChange={(e) => learnerField("otherLicencePlace", e.target.value)} data-testid="other-place">
                              <option value="">—</option>
                              {INTERSTATE_PLACES.map((place) => <option key={place} value={place}>{place}</option>)}
                            </select>
                          ) : (
                            <>
                              <input value={learnerDraft.otherLicencePlace} onChange={(e) => learnerField("otherLicencePlace", e.target.value)} list="other-licence-countries" maxLength={MAX_OTHER_PLACE_LENGTH} autoComplete="off" placeholder="Any country" data-testid="other-place" />
                              <datalist id="other-licence-countries">{COUNTRIES.map((country) => <option key={country} value={country} />)}</datalist>
                            </>
                          )}
                        </label>
                        <label className="field"><span>Licence type</span>
                          <select value={learnerDraft.otherLicenceClass} onChange={(e) => learnerField("otherLicenceClass", e.target.value)} data-testid="other-class">
                            <option value="">—</option>
                            {OTHER_LICENCE_CLASSES.map((cls) => <option key={cls} value={cls}>{OTHER_LICENCE_CLASS_LABELS[cls]}</option>)}
                          </select>
                        </label>
                        <label className="field full"><span>Licence number</span>
                          <input value={learnerDraft.otherLicenceNumber} onChange={(e) => learnerField("otherLicenceNumber", e.target.value)} maxLength={MAX_OTHER_NUMBER_LENGTH} autoCapitalize="characters" autoComplete="off" data-testid="other-number" />
                        </label>
                        <label className="field"><span>First issued</span>
                          <input type="date" value={learnerDraft.otherLicenceIssuedOn} onChange={(e) => learnerField("otherLicenceIssuedOn", e.target.value)} max={localNow().date} data-testid="other-issued" />
                          <small>If known, otherwise the issue date on the card.</small>
                        </label>
                        <label className="field"><span>Expiry</span>
                          <input type="date" value={learnerDraft.otherLicenceExpiresOn} onChange={(e) => learnerField("otherLicenceExpiresOn", e.target.value)} data-testid="other-expires" />
                          <small>Information only; not needed for the rule.</small>
                        </label>
                        {formOtherLicenceLine ? <div className="full"><RulesReminders reminders={[formOtherLicenceLine]} testId="other-licence-note" /></div> : null}
                      </>
                    ) : null}
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
                ) : isSaas ? null : (
                  <label className="field full"><span>Instructor <span className="req" aria-hidden="true">*</span></span>
                    <select value={learnerDraft.instructorId} onChange={(e) => learnerField("instructorId", e.target.value)}>
                      <option value="">Select instructor…</option>
                      {instructors.map((i) => <option key={i.id} value={i.id}>{instructorLabel(i)}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </section>

            {more.shown ? (
              <details className="fsect group more" data-testid="learner-more">
                <summary>More <small>{[more.transfer ? "Transfer" : null, more.archive ? "Archive" : null].filter(Boolean).join(" · ")} · rarely needed</small></summary>
                <div className="inner">
                  {/* The same Transfer / Archive panels, handlers, guards and confirmations as before; only their place changed.
                      Both stay locked while a lesson is running or ended-but-unsaved (phase !== "ready"), as before. */}
                  {moreLockedNote ? <p className="hint-note" data-testid="more-locked-note">{moreLockedNote}</p> : null}
                  {more.transfer ? (
                    transferDraft ? transferPanel : (
                      <button type="button" className="link transfer-link" disabled={saving || moreLocked} onClick={openTransferPanel} data-testid="transfer-open">
                        Transfer learner…
                      </button>
                    )
                  ) : null}
                  {more.archive ? (
                    archiveDraft ? archivePanel : (
                      <button type="button" className="link archive-link" disabled={saving || moreLocked || trialExpired} onClick={openArchivePanel}>
                        Archive learner…
                      </button>
                    )
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
          {!editingLearner || detail?.learner.draftAt ? (
            <section className="lblock fsect" data-testid="fsect-draft-notes">
              <div className="card-head"><h3>Notes for review</h3><small>kept with a draft only</small></div>
              <label className="field full"><span>What to check before confirming</span>
                <textarea rows={3} value={draftNotesText} maxLength={1500} onChange={(e) => setDraftNotesText(e.target.value)} placeholder="e.g. licence number: last digit unclear on the photo" data-testid="draft-notes-input" />
              </label>
              <p className="hint-note">&ldquo;Save as draft&rdquo; keeps whatever is filled in, even if it is incomplete or wrong; a value the app cannot use is left out and written to these notes.</p>
            </section>
          ) : null}
          {/* One primary action, pinned above the home indicator; un-pinned while a field has focus (globals.css), like the lesson's bar. */}
          <div className="learner-actions" data-testid="learner-actions">
            <button type="button" className="btn save" disabled={saving || trialExpired} onClick={submitLearnerForm} data-testid="save-learner">
              {saveLabel({ editing: editingLearner, saving, draft: editingLearner && Boolean(detail?.learner.draftAt) })}
            </button>
            {!editingLearner || detail?.learner.draftAt ? (
              <button type="button" className="btn ghost save-draft" disabled={saving || trialExpired} onClick={() => void saveAsDraft()} data-testid="save-learner-draft">
                {editingLearner ? "Save draft" : "Save as draft"}
              </button>
            ) : null}
            <button type="button" className="link learner-cancel" disabled={saving} onClick={closeLearnerForm} data-testid={editingLearner ? "cancel-edit-learner" : "cancel-new-learner"}>Cancel</button>
          </div>
        </section>
      ) : null}

      {/* While the learner form is open only the form shows; the open learner's detail, draft and running lesson are kept in state (and the
          draft on this device), so Cancel returns to exactly the same view. */}
      {detail && draft && !addingLearner ? (
        <>
          <section className="card summary">
            {/* Learner header (redesign): identity, the next lesson number, the 22-segment progress bar with the derived totals and
                the three gate chips — the same figures and statuses as before, from the same progress/totals. */}
            <div className="summary-head" data-testid="learner-header">
              <div className="summary-main">
                <span className="lc-avatar" aria-hidden="true">{initials(detail.learner.fullName)}</span>
                <div className="summary-id">
                  <small className="summary-name">{detail.learner.fullName}</small>
                  <span className="summary-meta">{learnerHeaderMeta(detail.learner)}</span>
                </div>
                <strong className="summary-next" data-testid="lesson-no">{panel === "completed" ? "CBT&A Completed" : panel === "draft" ? "Draft" : `Lesson #${lessonNo}`}</strong>
              </div>
              <div className="lc-prog">
                <div className="lc-prog-head">
                  <span>Competencies achieved</span>
                  <span>
                    <b data-testid="header-achieved">{detail.progress.achievedCount}</b> of 22 · {totals.lessonCount} {totals.lessonCount === 1 ? "lesson" : "lessons"} ·{" "}
                    <span data-testid="total-hours">{formatMinutes(totals.totalMinutes)} ({decimalHours(totals.totalMinutes)} h)</span> · <span data-testid="total-km">{totals.totalKm} km</span>
                  </span>
                </div>
                <span className="lc-segs" role="img" aria-label={`${detail.progress.achievedCount} of 22 competencies achieved`}>
                  {CORE_COMPETENCY_IDS.map((id) => <i key={id} className={detail.progress.competencies[id]?.achieved ? "on" : undefined} />)}
                </span>
              </div>
              <div className="lc-gates" data-testid="header-gates">
                {gateChips(summaryFromDetail(detail)).map((g) => (
                  <span key={g.id} className={`lc-chip ${g.state}`} data-gate={g.id} data-state={g.state}>{g.state === "done" ? "✓ " : ""}{g.label}</span>
                ))}
              </div>
            </div>
            <div className="summary-body">
            {licenceReminder ? <RulesReminders reminders={[licenceReminder]} testId="licence-reminder" /> : null}
            {eligibleFromLine ? <RulesReminders reminders={[eligibleFromLine]} testId="c23-from" /> : null}
            <RulesReminders reminders={learnerChecks} testId="learner-checks" />
            {recordsCheck && showRecordsCheck ? (
              <div className="reminders" data-testid="transfer-check">
                <p className="reminder amber transfer-check" data-tone="amber">
                  <span>{recordsCheckText(recordsCheck.fromName)}</span>
                  <button type="button" className="btn ghost small" disabled={saving || trialExpired} onClick={() => void markRecordsChecked()} data-testid="transfer-checked">Checked</button>
                </p>
              </div>
            ) : null}
            {/* Start Lesson under the learner's warnings (licence, C23, missing details, transfer check), above ID / PDF / Edit. */}
            {panel === "active" && phase === "ready" ? (
              <div className="start-top" data-testid="start-top">
                {panelReminders.length || showBookingLink ? (
                  <div className="start-reminders" data-testid="start-reminders">
                    <RulesReminders reminders={panelReminders} testId="panel-reminders" />
                    {showBookingLink ? <BookingLink /> : null}
                  </div>
                ) : null}
                <button type="button" className="btn huge go" disabled={trialExpired} onClick={startLesson}>Start Lesson #{lessonNo}</button>
                <p className="phase-note">Date and start time are taken from the clock. Competencies and signatures appear after you start.</p>
                {pastLesson ? (
                  <div className="past-lesson" data-testid="past-lesson">
                    <div className="grid">
                      <label className="field full"><span>Lesson date</span><input type="date" value={pastLesson.date} max={localNow().date} onChange={(e) => setPastLesson({ ...pastLesson, date: e.target.value, error: null })} data-testid="past-lesson-date" /></label>
                      <label className="field"><span>Start time</span><input type="time" value={pastLesson.start} onChange={(e) => setPastLesson({ ...pastLesson, start: e.target.value, error: null })} data-testid="past-lesson-start" /></label>
                      <label className="field"><span>Finish time</span><input type="time" value={pastLesson.finish} onChange={(e) => setPastLesson({ ...pastLesson, finish: e.target.value, error: null })} data-testid="past-lesson-finish" /></label>
                    </div>
                    {pastLesson.error ? <p className="hint danger" role="alert" data-testid="past-lesson-error">{pastLesson.error}</p> : null}
                    <div className="paste-actions">
                      <button type="button" className="btn primary" disabled={trialExpired} onClick={usePastLesson} data-testid="past-lesson-use">Continue</button>
                      <button type="button" className="btn ghost" onClick={() => setPastLesson(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="link paste-link" disabled={trialExpired} onClick={openPastLesson} data-testid="past-lesson-open">Record a past lesson</button>
                )}
              </div>
            ) : null}
            {/* The ACTGDS Website link (Integration ID) is a private-edition feature. */}
            {isSaas ? null : (
              <p className="meta integration-id">
                Integration ID: <code>{detail.learner.id}</code>
                <button type="button" className="link" onClick={() => void copyIntegrationId(detail.learner.id)}>Copy ID</button>
              </p>
            )}
            {panel === "draft" ? null : <ExportPdfButton key={detail.learner.id} learnerId={detail.learner.id} lessonCount={history.lessons.length} />}
            {canEditLearner ? (
              <button type="button" className="btn ghost block edit-learner-btn" disabled={saving || trialExpired} onClick={openEditLearner} data-testid="edit-learner">Edit learner</button>
            ) : null}
            {canTransfer && !canEditLearner ? (
              transferDraft ? transferPanel : (
                <button type="button" className="link transfer-link" disabled={saving || phase !== "ready"} onClick={openTransferPanel} data-testid="transfer-open">
                  Transfer learner…
                </button>
              )
            ) : null}
            {/* Archive never had an owner gate (any Access-verified instructor, server included): a colleague who cannot open
                Edit learner keeps the page-level link exactly as before; the owner finds it under Edit learner > More. */}
            {panel === "active" && !canEditLearner ? (
              archiveDraft ? archivePanel : (
                <button type="button" className="link archive-link" disabled={saving || phase !== "ready" || trialExpired} onClick={openArchivePanel}>
                  Archive learner…
                </button>
              )
            ) : null}
            {panel === "draft" ? (
              <div className="lifecycle draft" data-testid="draft-banner">
                <p><b>Draft</b> — not a record yet. Lessons and imports unlock after you confirm it.</p>
                {detail.learner.draftNotes ? <p className="draft-notes" data-testid="draft-notes">{detail.learner.draftNotes}</p> : <p className="meta">No notes. Check the details against the original, then confirm.</p>}
                {canEditLearner ? <button type="button" className="btn primary" disabled={saving || trialExpired} onClick={openEditLearner} data-testid="draft-review">Review and confirm</button> : <p className="meta">Only {detail.learner.instructorName || "the learner's instructor"} can review this draft.</p>}
              </div>
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
                <button type="button" className="btn primary block" disabled={saving || trialExpired} onClick={() => void setLearnerArchived(false)}>Restore learner</button>
              </div>
            ) : null}
            </div>
          </section>

          <CompetencyProgressCard progress={detail.progress} completion={detail.completion} invalidated={invalidation} />

          {detail.lessons.length === 0 && (panel === "active" || panel === "draft") ? (
            trialExpired ? (
              <p className="status info" data-testid="paper-import-trial-ended">Importing paper records is switched off: your free trial has ended.</p>
            ) : (
              <PaperImportPanel key={detail.learner.id} learnerId={detail.learner.id} canImport={panel === "active"} onImported={() => loadLearner(detail.learner.id)} />
            )
          ) : null}

          {panel === "completed" ? (
            <section className="card lesson-completed" data-testid="cbta-completed-card">
              <h2>CBT&amp;A Completed</h2>
              <p className="meta">
                23 Final Drive achieved{detail.completion ? ` in Lesson #${detail.completion.completingLessonNo}` : ""}. No further CBT&amp;A lessons can be started for {detail.learner.fullName}.
              </p>
              <div className="lifecycle suggest" data-testid="archive-suggestion">
                <p>You can archive {detail.learner.fullName} to keep your daily list short — nothing is deleted and you can restore any time. Or just leave them active.</p>
                {archiveDraft ? archivePanel : <button type="button" className="btn ghost small" disabled={saving || trialExpired} onClick={openArchivePanel}>Archive learner…</button>}
              </div>
            </section>
          ) : null}

          {panel !== "active" ? null : (
          <section className="card lesson" data-phase={phase} ref={lessonCardRef}>
            {/* Lesson status: Start Lesson → running timebar + End Lesson → ended. One primary action per state. */}
            <div className="lblock lesson-status" data-testid="lesson-status">
              <div className="card-head"><h2>Lesson #{lessonNo}</h2><small data-testid="lesson-date">{lessonDateLine(draft.lessonDate)}</small></div>
              {phase === "ready" ? (
                <p className="phase-note">Start the lesson with the learner&rsquo;s details above.</p>
              ) : (
                <div className="timebar">
                  <div><small>Started</small><strong>{draft.startTime}</strong></div>
                  <div className={phase === "running" ? "live" : undefined}>
                    <small>{phase === "running" ? "Elapsed" : "Duration"}</small>
                    <strong data-testid="duration">{phase === "running" ? (elapsed !== null ? formatMinutes(elapsed) : "—") : liveDuration !== null ? formatMinutes(liveDuration) : "—"}</strong>
                  </div>
                  <div><small>Finished</small><strong>{draft.finishTime || "—"}</strong></div>
                </div>
              )}
              {phase === "running" ? (
                <>
                  <button type="button" className="btn huge stop" onClick={endLesson}>End Lesson</button>
                  <p className="phase-note">Finish odometer unlocks after End Lesson.</p>
                </>
              ) : null}
            </div>

            {/* Odometer + derived values: duration, km, totals and the lesson number are calculated, never typed. */}
            <div className="lblock odo-block" data-testid="odometer-block">
              <div className="card-head"><h3>Odometer</h3>{odometerCarriedNote(totals, draft.startOdometer) ? <small className="hint">{odometerCarriedNote(totals, draft.startOdometer)}</small> : null}</div>
              <div className="grid odo">
                <label className="field"><span>Start odometer (km)</span>
                  <input id="lesson-field-start-odometer" type="text" inputMode="numeric" pattern="[0-9]*" value={draft.startOdometer} onChange={(e) => setField("startOdometer", e.target.value.replace(/\D/g, ""))} placeholder="e.g. 45210" />
                </label>
                <label className="field"><span>Finish odometer (km)</span>
                  <input id="lesson-field-finish-odometer" ref={finishOdoRef} type="text" inputMode="numeric" pattern="[0-9]*" value={draft.finishOdometer} onChange={(e) => setField("finishOdometer", e.target.value.replace(/\D/g, ""))} disabled={phase !== "ended"} placeholder={phase === "ended" ? "Enter now" : "After End Lesson"} />
                </label>
              </div>
              <div className="stats" aria-label="Derived values" data-testid="lesson-km">
                <div className="stat live"><small>This lesson</small><b data-testid="stat-duration">{stats.thisLesson.duration}</b><em data-testid="stat-km">{stats.thisLesson.km}</em></div>
                <div className="stat"><small>Total after save</small><b data-testid="stat-total">{stats.totalAfter.duration}</b><em>{stats.totalAfter.decimalHours} h · {stats.totalAfter.km}</em></div>
                <div className="stat"><small>Lesson number</small><b>#{stats.lessonNo}</b><em>calculated</em></div>
              </div>
              <p className="hint-note">Duration, km, totals and lesson number are always calculated, never typed.</p>
              {phase !== "ready" ? (
                <details className="edit-times group">
                  <summary>Edit date / times <small>only if the clock was wrong</small></summary>
                  <div className="inner">
                    <div className="grid">
                      <label className="field full"><span>Date</span><input id="lesson-field-date" type="date" value={draft.lessonDate} onChange={(e) => setField("lessonDate", e.target.value)} /></label>
                      <label className="field"><span>Start time</span><input id="lesson-field-times" type="time" value={draft.startTime} onChange={(e) => setField("startTime", e.target.value)} /></label>
                      <label className="field"><span>Finish time</span><input type="time" value={draft.finishTime} onChange={(e) => setField("finishTime", e.target.value)} /></label>
                    </div>
                  </div>
                </details>
              ) : null}
            </div>

            {phase !== "ready" ? (
              <>
                <div className="lblock" id="lesson-field-competency" data-testid="competency-block">
                  <div className="card-head"><h3>Competencies</h3><small>Tap a number · official CBT&amp;A list</small></div>
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
                {formReminders.length || draft.assessedIds.includes(FINAL_DRIVE_23) ? (
                  <div className="lblock" data-testid="reminders-block">
                    <RulesReminders reminders={formReminders} testId="form-reminders" />
                    {draft.assessedIds.includes(FINAL_DRIVE_23) ? (
                      <RouteCheckGroup state={routeState} home={home} achieved23={draft.achievedResults[FINAL_DRIVE_23] === "achieved"} fits={fitsRoute(draft)} inHistoryEdit={false} onChange={(next) => setDraft((current) => (current ? withRoute(current, next) : current))} testId="route-group" />
                    ) : null}
                  </div>
                ) : null}

                <div className="lblock" data-testid="notes-block">
                  <div className="grid">
                    <label className="field full"><span>Location</span><input value={draft.location} onChange={(e) => setField("location", e.target.value)} placeholder="Belconnen, Gungahlin…" /></label>
                    <label className="field full"><span>Comments</span><textarea rows={2} value={draft.comments} onChange={(e) => setField("comments", e.target.value)} /></label>
                  </div>
                </div>

                <div className="lblock" data-testid="signatures-block">
                  <div className="card-head"><h3>Signatures</h3><small>{draft.assessedIds.includes(FINAL_DRIVE_23) ? "both required to save" : "both now, or both later"}</small></div>
                  <div className="sigs">
                    <div id="lesson-field-adi-signature"><SignaturePad label="ADI signature" value={draft.adiSignature} onChange={(value) => setField("adiSignature", value)} /><SavedSignature value={draft.adiSignature} onUse={(value) => setField("adiSignature", value)} disabled={trialExpired} /></div>
                    <div id="lesson-field-learner-signature"><SignaturePad label="Learner signature" value={draft.learnerSignature} onChange={(value) => setField("learnerSignature", value)} /></div>
                  </div>
                </div>

                <SaveErrorSummary issues={shownSaveIssues} prefix="lesson" attempt={saveAttempt} />
                {showsSaveBar(phase) ? (
                  <div className="lesson-actions" data-testid="lesson-actions">
                    <button type="button" className="btn save" disabled={saving || trialExpired} onClick={() => void saveLesson()}>
                      {saving ? "Saving…" : `Save Lesson #${lessonNo}`}
                    </button>
                    {!draft.adiSignature && !draft.learnerSignature && !draft.assessedIds.includes(FINAL_DRIVE_23) ? (
                      <button type="button" className="btn ghost sign-later" disabled={saving || trialExpired} onClick={() => void saveLesson(true)} data-testid="save-sign-later">Save without signatures (sign later)</button>
                    ) : null}
                    <button type="button" className="link danger" onClick={discardLesson}>Discard this lesson</button>
                  </div>
                ) : (
                  <button type="button" className="link danger lesson-discard" onClick={discardLesson}>Discard this lesson</button>
                )}
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
                            <RouteCheckGroup state={editRouteState} home={home} achieved23={editDraft.achievedResults[FINAL_DRIVE_23] === "achieved"} fits={fitsRoute(editDraft)} inHistoryEdit onChange={(next) => setEditFieldValue((d) => withRoute(d, next))} testId="edit-route-group" />
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
                              {editUnsigned ? (
                                <p className="hint" data-testid="edit-unsigned-hint">Not signed yet: sign both now, or leave both blank and sign later.</p>
                              ) : editOriginal && contentChanged(editOriginal, editDraft) ? (
                                editSignOptional ? (
                                  <p className="hint" data-testid="edit-resign-hint">Content changed, so the old signatures were cleared. Sign both again now, or leave both blank: the lesson is saved as not signed and goes to To sign.</p>
                                ) : (
                                  <p className="hint danger">Content changed — both signatures were cleared. Please redraw both before saving (Final Drive 23 is signed when it is saved).</p>
                                )
                              ) : null}
                              <div id="edit-field-adi-signature"><SignaturePad label="ADI signature" value={editDraft.adiSignature} onChange={(value) => setEditFieldValue((d) => ({ ...d, adiSignature: value }))} /><SavedSignature value={editDraft.adiSignature} onUse={(value) => setEditFieldValue((d) => ({ ...d, adiSignature: value }))} disabled={trialExpired} /></div>
                              <div id="edit-field-learner-signature"><SignaturePad label="Learner signature" value={editDraft.learnerSignature} onChange={(value) => setEditFieldValue((d) => ({ ...d, learnerSignature: value }))} /></div>

                            </>
                          )}

                          <label className="field full"><span>Reason for this change (optional)</span>
                            <input data-testid="edit-reason" value={editReason} maxLength={200} onChange={(e) => setEditReason(e.target.value)} placeholder="e.g. wrong odometer reading" autoComplete="off" />
                            <small className="hint">{editReason.length}/200 · kept with the previous version, like initialling a correction on paper</small>
                          </label>

                          <SaveErrorSummary issues={shownEditIssues} prefix="edit" attempt={editAttempt} />
                          <button type="button" className="btn huge save" disabled={saving || trialExpired} onClick={() => void saveEditLesson()}>
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
                        {lesson.recordSource === "app" && lesson.signatureStatus === "unsigned" && panel !== "archived" && (!signedInInstructorId || lesson.instructorId === signedInInstructorId) ? (
                          <button type="button" className="h-unsigned" data-testid="unsigned-badge" disabled={trialExpired} onClick={() => setSignQueue({ startLessonId: lesson.id })}>Not signed · Sign now</button>
                        ) : null}
                        <span>{lesson.lessonDate} · {lesson.startTime ?? "—"}–{lesson.finishTime ?? "—"}</span>
                        {signedInInstructorId && lesson.instructorId !== signedInInstructorId ? (
                          <span className="h-readonly" data-testid="history-readonly">Recorded by {instructors.find((i) => i.id === lesson.instructorId)?.fullName ?? "another instructor"}</span>
                        ) : (
                          <button type="button" className="link h-edit" disabled={trialExpired} onClick={() => void startEditLesson(lesson.id)}>Edit</button>
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
                      {lesson.revisionCount > 0 || lesson.signedLater ? (
                        <p className="h-revisions">
                          <button type="button" className="link" data-testid="revisions-toggle" aria-expanded={revisionsOpenId === lesson.id} onClick={() => void toggleRevisions(lesson.id)}>
                            {lesson.revisionCount > 0 ? `Edited ${lesson.revisionCount} ${lesson.revisionCount === 1 ? "time" : "times"}${lesson.signedLater ? " · signed later" : ""}` : "Signed later"}
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

      {/* SaaS: no school line, but the G-NAF attribution stays (licence condition of the street suggestions). */}
      {isSaas ? (
        <footer className="foot"><span data-testid="gnaf-attribution">{GNAF_ATTRIBUTION}</span></footer>
      ) : <footer className="foot">ACT Golden Driving School · Internal instructor tool<br /><span data-testid="gnaf-attribution">{GNAF_ATTRIBUTION}</span></footer>}
    </main>
  );
}
