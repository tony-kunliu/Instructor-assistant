"use client";

import { useState } from "react";
import type { Learner, Lesson } from "@/lib/types.ts";

type Phase = "idle" | "loading" | "needs-adi-number" | "building" | "error";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}

/**
 * Exports the official ADI CBT&A Checklist PDF for a learner, entirely in
 * the browser: fetches only this learner's already-saved lessons (never a
 * draft) plus the template PDF and font as static assets, fills it with
 * pdf-lib, and triggers a download. Nothing is sent to a third party — the
 * export endpoint sits behind the same site-wide access protection as the
 * rest of the app (see middleware.ts).
 */
export default function ExportPdfButton({ learnerId, lessonCount }: { learnerId: string; lessonCount: number }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [adiNumberDraft, setAdiNumberDraft] = useState("");
  const [pending, setPending] = useState<{ learner: Learner; lessons: Lesson[] } | null>(null);

  const buildAndDownload = async (learner: Learner, lessons: Lesson[]) => {
    setPhase("building");
    try {
      const [templateBytes, fontBytes, { buildCbtaChecklistPdf }] = await Promise.all([
        fetch("/pdf-template/adi-cbta-checklist.pdf").then((r) => r.arrayBuffer()),
        fetch("/fonts/NotoSansSC-Regular.otf").then((r) => r.arrayBuffer()),
        import("@/lib/pdf-export.ts"),
      ]);
      const result = await buildCbtaChecklistPdf({ templateBytes, fontBytes, learner, lessons });
      const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `CBTA-Checklist-${learner.fullName.replace(/[^a-z0-9]+/gi, "-") || "learner"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPending(null);
      setPhase("idle");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  };

  const startExport = async () => {
    setError(null);
    setPhase("loading");
    try {
      const data = await api<{ learner: Learner; lessons: Lesson[] }>(`/api/learners/${encodeURIComponent(learnerId)}/export`);
      if (!data.learner.instructorAdiNumber) {
        setPending(data);
        setAdiNumberDraft("");
        setPhase("needs-adi-number");
        return;
      }
      await buildAndDownload(data.learner, data.lessons);
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  };

  const saveAdiNumberAndExport = async () => {
    if (!pending) return;
    const trimmed = adiNumberDraft.trim();
    if (!trimmed) {
      setError("ADI number is required for the official PDF.");
      return;
    }
    setError(null);
    setPhase("loading");
    try {
      await api(`/api/instructors/${encodeURIComponent(pending.learner.instructorId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adiNumber: trimmed }),
      });
      await buildAndDownload({ ...pending.learner, instructorAdiNumber: trimmed }, pending.lessons);
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  };

  if (lessonCount === 0) {
    return <p className="hint">No saved lessons yet — nothing to export.</p>;
  }

  return (
    <div className="export-pdf">
      {phase === "needs-adi-number" ? (
        <div className="export-adi-prompt">
          <p className="hint">The official checklist needs an ADI number, which hasn&rsquo;t been set for this instructor yet.</p>
          <label className="field">
            <span>ADI number</span>
            <input value={adiNumberDraft} onChange={(e) => setAdiNumberDraft(e.target.value)} autoFocus />
          </label>
          <button type="button" className="btn primary block" onClick={() => void saveAdiNumberAndExport()}>
            Save &amp; Export
          </button>
        </div>
      ) : (
        <button type="button" className="btn ghost block" disabled={phase === "loading" || phase === "building"} onClick={() => void startExport()}>
          {phase === "loading" ? "Preparing…" : phase === "building" ? "Building PDF…" : "Export CBT&A PDF"}
        </button>
      )}
      {error ? <p className="status error">{error}</p> : null}
    </div>
  );
}
