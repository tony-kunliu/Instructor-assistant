"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Learner, Lesson } from "@/lib/types.ts";

type Phase = "idle" | "loading" | "needs-adi-number" | "building" | "confirm-missing" | "error";

/** A finished PDF that the user must confirm before download, because some characters would print as empty boxes. */
type Unconfirmed = { bytes: Uint8Array; filename: string; warning: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}

/** A static asset must be a real file: a 404, an Access login page (HTML) or a network failure is an error, never a font. */
async function fetchAsset(url: string, what: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok) throw new Error(`Could not load ${what} (HTTP ${response.status}). Check your connection and try again.`);
  if (type.includes("text/html")) throw new Error(`Could not load ${what}: the server returned a web page instead of the file. Sign in again and retry.`);
  return response.arrayBuffer();
}

function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Exports the official ADI CBT&A Checklist PDF for a learner, entirely in
 * the browser: fetches only this learner's already-saved lessons (never a
 * draft) plus the template PDF and a compact font as static assets, fills it
 * with pdf-lib, and triggers a download. The full 16 MB font is fetched only
 * when a rare Chinese character needs it. Nothing is sent to a third party —
 * the export endpoint sits behind the same site-wide access protection as the
 * rest of the app (see middleware.ts).
 */
export default function ExportPdfButton({ learnerId, lessonCount }: { learnerId: string; lessonCount: number }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adiNumberDraft, setAdiNumberDraft] = useState("");
  const [pending, setPending] = useState<{ learner: Learner; lessons: Lesson[] } | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<Unconfirmed | null>(null);
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Move focus into the confirm dialog so keyboard and screen-reader users land on the decision, safest action first.
  useEffect(() => {
    if (phase === "confirm-missing") cancelRef.current?.focus();
  }, [phase]);

  const buildAndDownload = async (learner: Learner, lessons: Lesson[]) => {
    setPhase("building");
    setProgress("Loading the PDF font…");
    try {
      const [templateBytes, fontBytes, { buildCbtaChecklistPdf, exportWarning }] = await Promise.all([
        fetchAsset("/pdf-template/adi-cbta-checklist.pdf", "the checklist template"),
        fetchAsset("/fonts/NotoSansSC-Subset.otf", "the PDF font"),
        import("@/lib/pdf-export.ts"),
      ]);
      const result = await buildCbtaChecklistPdf({
        templateBytes,
        fontBytes,
        fallbackFontBytes: () => {
          setProgress("Downloading the full font for rare Chinese characters (about 16 MB)…");
          return fetchAsset("/fonts/NotoSansSC-Regular.otf", "the full PDF font");
        },
        learner,
        lessons,
      });
      const filename = `CBTA-Checklist-${learner.fullName.replace(/[^a-z0-9]+/gi, "-") || "learner"}.pdf`;
      const warning = exportWarning(result);
      setPending(null);
      if (warning) {
        // Never hand over a PDF with empty boxes silently: the user confirms first.
        setUnconfirmed({ bytes: result.bytes, filename, warning });
        setPhase("confirm-missing");
        return;
      }
      downloadPdf(result.bytes, filename);
      setPhase("idle");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    } finally {
      setProgress(null);
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

  const downloadAnyway = () => {
    if (!unconfirmed) return;
    downloadPdf(unconfirmed.bytes, unconfirmed.filename);
    setUnconfirmed(null);
    setPhase("idle");
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
      ) : phase === "confirm-missing" && unconfirmed ? (
        <div className="export-adi-prompt" role="alertdialog" aria-labelledby={titleId} aria-describedby={`${titleId}-msg`}>
          <div className="status error export-missing" data-testid="export-missing-warning">
            <p id={titleId}><strong>Some characters cannot be printed</strong></p>
            <p id={`${titleId}-msg`}>{unconfirmed.warning}</p>
          </div>
          <p className="hint">Cancel and correct the text first, or download the PDF anyway.</p>
          <button ref={cancelRef} type="button" className="btn primary block" onClick={() => { setUnconfirmed(null); setPhase("idle"); }}>
            Cancel
          </button>
          <button type="button" className="btn ghost block" onClick={downloadAnyway}>
            Download anyway
          </button>
        </div>
      ) : (
        <button type="button" className="btn ghost block" disabled={phase === "loading" || phase === "building"} onClick={() => void startExport()}>
          {phase === "loading" ? "Preparing…" : phase === "building" ? (progress ?? "Building PDF…") : "Export CBT&A PDF"}
        </button>
      )}
      {error ? <p className="status error">{error}</p> : null}
    </div>
  );
}
