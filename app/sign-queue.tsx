"use client";

// To sign queue (Tony 2026-10-22): lessons saved without signatures are signed later, one after another. Each lesson is
// shown read-only so the learner sees exactly what they sign; signing changes only the two signatures (lib/repo.ts#signLesson).
import { useEffect, useState } from "react";
import { formatMinutes } from "@/lib/calc.ts";
import { formatDate } from "@/lib/rules.ts";
import type { Lesson, UnsignedLessonItem } from "@/lib/types.ts";
import SignaturePad from "./signature-pad.tsx";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}

const lessonUrl = (item: UnsignedLessonItem) => `/api/learners/${encodeURIComponent(item.learnerId)}/lessons/${encodeURIComponent(item.lessonId)}`;

type Props = {
  items: UnsignedLessonItem[];
  /** Lesson to open first (from a "Sign now" button in History); the oldest otherwise. */
  startLessonId?: string | null;
  onSigned: (item: UnsignedLessonItem) => void;
  onClose: () => void;
};

export default function SignQueue({ items, startLessonId, onSigned, onClose }: Props) {
  const [currentId, setCurrentId] = useState<string | null>(() => (items.some((i) => i.lessonId === startLessonId) ? startLessonId! : items[0]?.lessonId ?? null));
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [adi, setAdi] = useState("");
  const [learner, setLearner] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedCount, setSignedCount] = useState(0);
  const current = items.find((i) => i.lessonId === currentId) ?? null;
  const position = current ? items.indexOf(current) + 1 : 0;

  useEffect(() => {
    setLesson(null);
    setAdi("");
    setLearner("");
    setError(null);
    if (!current) return;
    let live = true;
    api<{ lesson: Lesson }>(lessonUrl(current))
      .then((data) => { if (live) setLesson(data.lesson); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const nextAfter = (id: string) => {
    const remaining = items.filter((i) => i.lessonId !== id);
    const at = items.findIndex((i) => i.lessonId === id);
    return remaining[at] ?? remaining[0] ?? null;
  };

  const sign = async () => {
    if (!current) return;
    if (!adi || !learner) return setError("Both signatures are needed to sign this lesson.");
    setBusy(true);
    setError(null);
    try {
      await api(`${lessonUrl(current)}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adiSignature: adi, learnerSignature: learner }) });
      const next = nextAfter(current.lessonId);
      setSignedCount((n) => n + 1);
      onSigned(current);
      setCurrentId(next?.lessonId ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    if (!current) return;
    const at = items.indexOf(current);
    setCurrentId(items[(at + 1) % items.length].lessonId);
  };

  return (
    <section className="card sign-queue" data-testid="sign-queue">
      <div className="card-head">
        <h2>To sign</h2>
        <small>{current ? `${position} of ${items.length}` : signedCount ? `${signedCount} signed` : "nothing left"}</small>
      </div>
      {!current ? (
        <>
          <p data-testid="sign-queue-done">{signedCount ? "All lessons are signed." : "No lessons are waiting to be signed."}</p>
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
        </>
      ) : (
        <>
          <p className="sign-who" data-testid="sign-queue-title"><b>{current.learnerName}</b> · Lesson #{current.lessonNo} · {formatDate(current.lessonDate)}</p>
          {lesson ? (
            <dl className="sign-record" data-testid="sign-queue-record">
              <div><dt>Time</dt><dd>{lesson.startTime ?? "—"}–{lesson.finishTime ?? "—"}{lesson.durationMinutes !== null ? ` · ${formatMinutes(lesson.durationMinutes)}` : ""}</dd></div>
              <div><dt>Odometer</dt><dd>{lesson.startOdometer ?? "—"} → {lesson.finishOdometer ?? "—"}{lesson.distanceKm !== null ? ` · ${lesson.distanceKm} km` : ""}</dd></div>
              <div><dt>Taught</dt><dd>{lesson.taught || "—"}</dd></div>
              <div><dt>Assessed</dt><dd>{lesson.competenciesAssessed || "—"}</dd></div>
              <div><dt>Achieved</dt><dd>{lesson.achieved || "—"}</dd></div>
              {lesson.location ? <div><dt>Location</dt><dd>{lesson.location}</dd></div> : null}
              {lesson.comments ? <div><dt>Comments</dt><dd>{lesson.comments}</dd></div> : null}
            </dl>
          ) : !error ? <p className="meta">Loading…</p> : null}
          <p className="hint">Go through this record with the learner. If anything is wrong, correct it in History first, then sign.</p>
          <div className="sigs">
            <SignaturePad label="ADI signature" value={adi} onChange={setAdi} />
            <SignaturePad label="Learner signature" value={learner} onChange={setLearner} />
          </div>
          {error ? <p className="hint danger" role="alert" data-testid="sign-queue-error">{error}</p> : null}
          <div className="sign-actions">
            <button type="button" className="btn save" disabled={busy || !lesson} onClick={() => void sign()} data-testid="sign-queue-sign">
              {busy ? "Signing…" : `Sign Lesson #${current.lessonNo}`}
            </button>
            {items.length > 1 ? <button type="button" className="btn ghost" disabled={busy} onClick={skip}>Skip</button> : null}
            <button type="button" className="link" disabled={busy} onClick={onClose}>Close</button>
          </div>
        </>
      )}
    </section>
  );
}
