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
import type { Instructor, Learner, Lesson } from "@/lib/types.ts";
import SignaturePad from "./signature-pad.tsx";

type LessonDraft = {
  lessonDate: string;
  startTime: string;
  finishTime: string;
  startOdometer: string;
  finishOdometer: string;
  taught: string;
  competenciesAssessed: string;
  achieved: string;
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
  instructorName: string;
};

type Detail = { learner: Learner; totals: Totals; lessons: Lesson[] };

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
  instructorName: "",
};

function freshLesson(startOdometer: number | null): LessonDraft {
  return {
    lessonDate: localNow().date,
    startTime: "",
    finishTime: "",
    startOdometer: startOdometer === null ? "" : String(startOdometer),
    finishOdometer: "",
    taught: "",
    competenciesAssessed: "",
    achieved: "",
    location: "",
    comments: "",
    adiSignature: "",
    learnerSignature: "",
  };
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
  const [learnerDraft, setLearnerDraft] = useState<LearnerDraft>(emptyLearner);
  const [status, setStatus] = useState<{ kind: "info" | "error" | "ok"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [clock, setClock] = useState(() => localNow().time);
  const finishOdoRef = useRef<HTMLInputElement>(null);

  const totals = detail?.totals ?? EMPTY_TOTALS;

  const loadLearner = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDraft(null);
    if (!id) return;
    storage.set(LAST_LEARNER_KEY, id);
    try {
      const data = await api<Detail>(`/api/learners/${encodeURIComponent(id)}`);
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
        const [learnerData, instructorData] = await Promise.all([
          api<{ learners: Learner[] }>("/api/learners"),
          api<{ instructors: Instructor[] }>("/api/instructors"),
        ]);
        setLearners(learnerData.learners);
        setInstructors(instructorData.instructors);
        const last = storage.get(LAST_LEARNER_KEY);
        if (last && learnerData.learners.some((l) => l.id === last)) await loadLearner(last);
        else if (!learnerData.learners.length) setAddingLearner(true);
      } catch (error) {
        setStatus({ kind: "error", text: (error as Error).message });
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
      storage.set(LAST_INSTRUCTOR_KEY, learnerDraft.instructorName.trim());
      setLearners((current) => [...current, learner].sort((a, b) => a.fullName.localeCompare(b.fullName)));
      setInstructors((current) => current.some((i) => i.id === learner.instructorId) ? current : [...current, { id: learner.instructorId, fullName: learner.instructorName }]);
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

  const saveLesson = async () => {
    if (!detail || !draft) return;
    setSaving(true);
    setStatus(null);
    try {
      const result = await api<{ lesson: Lesson; totals: Totals }>(`/api/learners/${encodeURIComponent(detail.learner.id)}/lessons`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      storage.remove(draftKey(detail.learner.id));
      setDetail({ ...detail, totals: result.totals, lessons: [result.lesson, ...detail.lessons] });
      setDraft(freshLesson(result.totals.lastFinishOdometer));
      setStatus({ kind: "ok", text: `Lesson #${result.lesson.lessonNo} saved.` });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setStatus({ kind: "error", text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const openAddLearner = () => {
    setLearnerDraft({ ...emptyLearner, instructorName: storage.get(LAST_INSTRUCTOR_KEY) ?? instructors[0]?.fullName ?? "" });
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

  const learnerField = (key: keyof LearnerDraft, value: string) => setLearnerDraft((current) => ({ ...current, [key]: value }));

  return (
    <main className="app">
      <header className="topbar">
        <img src="/icon.svg" width={32} height={32} alt="" />
        <div>
          <strong>ACTGDS Driver</strong>
          <small>CBT&amp;A Lesson Checklist</small>
        </div>
      </header>

      <section className="card picker">
        <label className="field">
          <span>Learner</span>
          <select value={selectedId} onChange={(e) => { setAddingLearner(false); void loadLearner(e.target.value); }} aria-label="Select learner">
            <option value="">{learners.length ? "Select learner…" : "No learners yet"}</option>
            {learners.map((learner) => <option key={learner.id} value={learner.id}>{learner.fullName}</option>)}
          </select>
        </label>
        <button type="button" className="btn ghost" onClick={() => (addingLearner ? setAddingLearner(false) : openAddLearner())}>
          {addingLearner ? "Cancel" : "+ New"}
        </button>
      </section>

      {status ? <p className={`status ${status.kind}`} role="status">{status.text}</p> : null}

      {addingLearner ? (
        <section className="card">
          <h2>New learner</h2>
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
            <label className="field full"><span>Instructor *</span>
              <input list="instructor-list" value={learnerDraft.instructorName} onChange={(e) => learnerField("instructorName", e.target.value)} autoComplete="off" />
              <datalist id="instructor-list">{instructors.map((i) => <option key={i.id} value={i.fullName} />)}</datalist>
            </label>
          </div>
          <button type="button" className="btn primary block" disabled={saving} onClick={() => void addLearner()}>
            {saving ? "Saving…" : "Save learner"}
          </button>
        </section>
      ) : null}

      {detail && draft && !addingLearner ? (
        <>
          <section className="card summary">
            <div className="summary-main">
              <small>{detail.learner.fullName}</small>
              <strong data-testid="lesson-no">Lesson #{lessonNo}</strong>
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
          </section>

          <section className="card lesson">
            {phase === "ready" ? (
              <button type="button" className="btn huge go" onClick={startLesson}>Start Lesson</button>
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
                <input type="text" inputMode="numeric" pattern="[0-9]*" value={draft.startOdometer} onChange={(e) => setField("startOdometer", e.target.value.replace(/\D/g, ""))} placeholder="e.g. 45210" />
              </label>
              <label className="field"><span>Finish odometer (km)</span>
                <input ref={finishOdoRef} type="text" inputMode="numeric" pattern="[0-9]*" value={draft.finishOdometer} onChange={(e) => setField("finishOdometer", e.target.value.replace(/\D/g, ""))} placeholder={phase === "ended" ? "Enter now" : "At end"} />
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
                <div className="grid">
                  <label className="field full"><span>Taught</span><textarea rows={2} value={draft.taught} onChange={(e) => setField("taught", e.target.value)} /></label>
                  <label className="field full"><span>Competencies Assessed</span><textarea rows={2} value={draft.competenciesAssessed} onChange={(e) => setField("competenciesAssessed", e.target.value)} /></label>
                  <label className="field full"><span>Achieved</span><textarea rows={2} value={draft.achieved} onChange={(e) => setField("achieved", e.target.value)} /></label>
                  <label className="field full"><span>Location</span><input value={draft.location} onChange={(e) => setField("location", e.target.value)} placeholder="Belconnen, Gungahlin…" /></label>
                  <label className="field full"><span>Comments</span><textarea rows={2} value={draft.comments} onChange={(e) => setField("comments", e.target.value)} /></label>
                </div>

                <details className="edit-times">
                  <summary>Edit date / times</summary>
                  <div className="grid">
                    <label className="field full"><span>Date</span><input type="date" value={draft.lessonDate} onChange={(e) => setField("lessonDate", e.target.value)} /></label>
                    <label className="field"><span>Start time</span><input type="time" value={draft.startTime} onChange={(e) => setField("startTime", e.target.value)} /></label>
                    <label className="field"><span>Finish time</span><input type="time" value={draft.finishTime} onChange={(e) => setField("finishTime", e.target.value)} /></label>
                  </div>
                </details>

                <SignaturePad label="ADI signature" value={draft.adiSignature} onChange={(value) => setField("adiSignature", value)} />
                <SignaturePad label="Learner signature" value={draft.learnerSignature} onChange={(value) => setField("learnerSignature", value)} />

                <button type="button" className="btn huge save" disabled={saving || phase !== "ended"} onClick={() => void saveLesson()}>
                  {saving ? "Saving…" : phase === "ended" ? `Save Lesson #${lessonNo}` : "Save (tap End Lesson first)"}
                </button>
                <button type="button" className="link danger" onClick={discardLesson}>Discard this lesson</button>
              </>
            ) : null}
          </section>

          <section className="card history">
            <h2>History</h2>
            {!detail.lessons.length ? <p className="empty">No lessons yet.</p> : (
              <ol>
                {detail.lessons.map((lesson) => (
                  <li key={lesson.id} data-testid="history-row">
                    <div className="h-top">
                      <span className="h-no">#{lesson.lessonNo}</span>
                      <span>{lesson.lessonDate} · {lesson.startTime}–{lesson.finishTime}</span>
                    </div>
                    <div className="h-nums">
                      <span>{formatMinutes(lesson.durationMinutes)} · {lesson.distanceKm} km</span>
                      <span>Total {formatMinutes(lesson.cumulativeMinutes)} · {lesson.cumulativeKm} km</span>
                    </div>
                    <div className="h-odo">Odo {lesson.startOdometer} → {lesson.finishOdometer}{lesson.location ? ` · ${lesson.location}` : ""}</div>
                    {lesson.taught ? <p><b>Taught:</b> {lesson.taught}</p> : null}
                    {lesson.competenciesAssessed ? <p><b>Assessed:</b> {lesson.competenciesAssessed}</p> : null}
                    {lesson.achieved ? <p><b>Achieved:</b> {lesson.achieved}</p> : null}
                    {lesson.comments ? <p><b>Comments:</b> {lesson.comments}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}

      <footer className="foot">ACT Golden Driving School · Internal instructor tool</footer>
    </main>
  );
}
